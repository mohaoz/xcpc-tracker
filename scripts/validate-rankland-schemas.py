"""Offline design-contract checks. This tool never applies data to the catalog."""
import copy
import json
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

from jsonschema import Draft202012Validator, FormatChecker, ValidationError
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['rankland-source', 'rankland-review', 'rankland-award-review']
SCHEMAS = {name: json.loads((ROOT / 'schemas' / f'{name}.schema.json').read_text()) for name in NAMES}
registry = Registry()
for schema in SCHEMAS.values():
    Draft202012Validator.check_schema(schema)
    registry = registry.with_resource(schema['$id'], Resource.from_contents(schema))
VALIDATORS = {name: Draft202012Validator(schema, registry=registry, format_checker=FormatChecker()) for name, schema in SCHEMAS.items()}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(values, label):
    require(len(values) == len(set(values)), f'duplicate {label}')


def validate(mapping, awards):
    VALIDATORS['rankland-review'].validate(mapping)
    VALIDATORS['rankland-award-review'].validate(awards)
    require(mapping['synthetic'] == awards['synthetic'], 'synthetic mismatch')
    require(mapping['catalog_sha256'] == awards['catalog_sha256'], 'catalog hash mismatch')
    unique([e['entry_id'] for e in mapping['entries']], 'mapping entry ID')
    unique([e['source']['provider_contest_id'] for e in mapping['entries']], 'source identity')
    defaults = []
    approved = {}
    for entry in mapping['entries']:
        source = entry['source']
        require(source['provider_contest_id'] == 'srk:' + source['srk_path'], 'source ID/path mismatch')
        require(source['srk_path'].startswith(source['collection'] + '/'), 'collection/path mismatch')
        url = urlsplit(source['page_url'])
        require(url.netloc in ('rl.algoux.cn', 'rl.algoux.org'), 'unexpected RankLand host')
        require(not url.fragment, 'page URL must not have a fragment')
        if url.path == '/collection/official':
            query = parse_qs(url.query, keep_blank_values=True)
            require(len(query.get('rankId', [])) == 1 and bool(query['rankId'][0].strip()), 'missing or duplicate rankId')
        else:
            require(url.path.startswith('/ranklist/') and len(url.path.split('/')) == 3 and bool(url.path.split('/')[-1]), 'invalid ranklist route')
        if entry['status'] == 'approved':
            selected = entry['selection']['contest_id']
            require(selected in entry['candidate_contest_ids'], 'selection is not a candidate')
            approved[entry['entry_id']] = entry
            if entry['selection']['make_default']:
                defaults.append(selected)
    unique(defaults, 'default target')
    unique([e['entry_id'] for e in awards['entries']], 'award entry ID')
    published = []
    for entry in awards['entries']:
        link = approved.get(entry['mapping_entry_id'])
        require(link is not None, 'award must reference approved mapping')
        require(link['selection']['contest_id'] == entry['contest_id'], 'award target mismatch')
        require(link['source']['content_sha256'] == entry['source_content_sha256'], 'source hash mismatch')
        if entry['status'] == 'approved':
            published.append(entry['contest_id'])
        if 'result' not in entry:
            continue
        result = entry['result']
        cuts = [result['cutoffs'][medal] for medal in ('gold', 'silver', 'bronze')]
        require(any(c is not None for c in cuts), 'all medals missing')
        if any(c is None for c in cuts):
            require(bool(result.get('missing_medals_reason', '').strip()), 'missing medal explanation')
        present = [c for c in cuts if c is not None]
        unique([c['team_id'] for c in present], 'boundary team')
        ranks = [c['rank'] for c in present]
        solved = [c['solved'] for c in present]
        require(all(a < b for a, b in zip(ranks, ranks[1:])), 'medal ranks not increasing')
        require(all(a >= b for a, b in zip(solved, solved[1:])), 'medal solved counts not decreasing')
        require(max(ranks) <= result['eligible_team_count'], 'rank exceeds eligible count')
        require(max(solved) <= result['problem_count'], 'solved exceeds problem count')
    unique(published, 'approved award target')


def main():
    base = ROOT / 'fixtures/imports/rankland'
    mapping = json.loads((base / 'mapping-review.example.json').read_text())
    awards = json.loads((base / 'award-review.example.json').read_text())
    validate(mapping, awards)
    # A no-medal group and all-eligible group are accepted with explicit semantics.
    m, a = copy.deepcopy(mapping), copy.deepcopy(awards)
    result = a['entries'][0]['result']
    result['group']['scope'] = 'all_eligible'
    del result['group']['source_group_ids']
    result['cutoffs']['bronze'] = None
    result['missing_medals_reason'] = 'Synthetic group has no bronze award.'
    validate(m, a)
    # JSON object key order cannot affect medal semantics.
    result['cutoffs'] = {k: result['cutoffs'][k] for k in ('bronze', 'gold', 'silver')}
    validate(m, a)
    cases = [
        ('duplicate default', lambda m, a: m['entries'][1].update(status='approved', selection=m['entries'][0]['selection'], review=m['entries'][0]['review'])),
        ('all medals missing', lambda m, a: a['entries'][0]['result'].update(cutoffs={'gold': None, 'silver': None, 'bronze': None}, missing_medals_reason='No awards')),
        ('missing approval', lambda m, a: m['entries'][0].pop('review')),
        ('pending selection', lambda m, a: m['entries'][1].update(selection=m['entries'][0]['selection'])),
        ('unknown field', lambda m, a: m.update(typo=True)),
        ('unpinned commit', lambda m, a: m['entries'][0]['source'].update(commit_sha='master')),
        ('invalid time', lambda m, a: m['entries'][0]['review'].update(reviewed_at='yesterday')),
        ('unsafe path', lambda m, a: m['entries'][0]['source'].update(srk_path='official/../test.srk.json')),
        ('identity mismatch', lambda m, a: m['entries'][0]['source'].update(provider_contest_id='srk:official/other.srk.json')),
        ('no rankId', lambda m, a: m['entries'][0]['source'].update(page_url='https://rl.algoux.cn/collection/official?x=1')),
        ('duplicate rankId', lambda m, a: m['entries'][0]['source'].update(page_url='https://rl.algoux.cn/collection/official?rankId=a&rankId=b')),
        ('unlisted candidate', lambda m, a: m['entries'][0]['selection'].update(contest_id='unknown')),
        ('catalog mismatch', lambda m, a: a.update(catalog_sha256='f'*64)),
        ('source mismatch', lambda m, a: a['entries'][0].update(source_content_sha256='f'*64)),
        ('unapproved mapping', lambda m, a: a['entries'][0].update(mapping_entry_id='mapping-pending')),
        ('blocked result', lambda m, a: a['entries'][2].update(result=a['entries'][0]['result'])),
        ('missing group', lambda m, a: a['entries'][0]['result']['group'].pop('source_group_ids')),
        ('frozen standings', lambda m, a: a['entries'][0]['result'].update(standings_state='frozen')),
        ('implicit estimate', lambda m, a: a['entries'][0]['result'].update(method='ratio')),
        ('wrong output unit', lambda m, a: a['entries'][0]['result'].update(penalty_unit='seconds')),
        ('rank too large', lambda m, a: a['entries'][0]['result']['cutoffs']['bronze'].update(rank=11)),
        ('wrong order', lambda m, a: a['entries'][0]['result']['cutoffs']['gold'].update(rank=4)),
        ('too many solved', lambda m, a: a['entries'][0]['result']['cutoffs']['gold'].update(solved=14)),
        ('unexplained null', lambda m, a: a['entries'][0]['result']['cutoffs'].update(bronze=None)),
        ('duplicate award target', lambda m, a: a['entries'][1].update(status='approved', review=a['entries'][0]['review'])),
    ]
    for name, mutate in cases:
        m, a = copy.deepcopy(mapping), copy.deepcopy(awards)
        mutate(m, a)
        try:
            validate(m, a)
        except (ValueError, ValidationError):
            continue
        raise AssertionError(f'negative case unexpectedly passed: {name}')
    print(f'3 schemas valid; 3 fixture variants passed; {len(cases)} negative cases rejected. No catalog writes.')


if __name__ == '__main__':
    main()

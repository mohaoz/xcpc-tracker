# apps/service

Python localhost service for acquisition, normalization, tasks, and local API.

## Local Development

Create the local virtual environment once:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
```

Run tests:

```bash
.venv/bin/python -m pytest tests
```

Run the CLI:

```bash
.venv/bin/xvg --help
.venv/bin/xvg contest sync https://codeforces.com/gym/615540 --alias ccinv25db --tag "ccpc inv. 2025" --tag "东北"
.venv/bin/xvg coverage ccinv25db
```

Optional: use authenticated Codeforces API requests by exporting your key and secret first:

```bash
export XVG_CODEFORCES_API_KEY="your_key"
export XVG_CODEFORCES_API_SECRET="your_secret"

.venv/bin/xvg contest sync https://codeforces.com/gym/615540 --alias ccinv25db --tag "ccpc inv. 2025" --tag "东北"
```

Other useful commands:

```bash
.venv/bin/xvg contest list
.venv/bin/xvg contest list --tag "ccpc inv. 2025"
.venv/bin/xvg contest list --tag "ccpc inv. 2025" --tag "东北"
.venv/bin/xvg contest list --with-coverage
.venv/bin/xvg contest annotate 615540 --alias ccinv25db --tag "ccpc inv. 2025" --tag "东北"
.venv/bin/xvg contest export --output ./xvg-contests.json
.venv/bin/xvg contest import ./xvg-contests.json
.venv/bin/xvg contest import ./xvg-contests.json --sync
.venv/bin/xvg member sync alice tourist
.venv/bin/xvg member list
.venv/bin/xvg coverage 615540
.venv/bin/xvg coverage "Sample Gym"
.venv/bin/xvg config export --output ./xvg-config.json
.venv/bin/xvg config import ./xvg-config.json
```

Notes:
- API credentials are optional.
- Credentials are read from environment variables only and are not exported by `xvg config export`.
- Authenticated requests may help with some Codeforces API access patterns, but they do not guarantee that every Gym endpoint or contest will succeed.

Run the local API:

```bash
.venv/bin/python -m uvicorn xcpc_vp_gather.main:app --reload
```

Rule: prefer `.venv/bin/python ...` for all service commands instead of relying on global Python or `pytest` on PATH.

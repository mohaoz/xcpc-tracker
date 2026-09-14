import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readJson } from './source-import-lib.mjs';
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
let ready;
export async function validateSchema(name, value) {
  ready ??= Promise.all(['rankland-source', 'rankland-review', 'rankland-award-review', 'catalog-snapshot'].map(async name => {
    ajv.addSchema(await readJson(new URL(`../schemas/${name}.schema.json`, import.meta.url)), `${name}.schema.json`);
  }));
  await ready;
  const check = ajv.getSchema(`${name}.schema.json`);
  if (!check(value)) throw new Error(`${name}: ${ajv.errorsText(check.errors)}`);
}

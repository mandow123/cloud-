import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('health incidents require three failed readiness probes and report only changes and recovery', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util
spec=importlib.util.spec_from_file_location('health','scripts/ops/stabilization-health.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
state={}
for index in range(2):
 state,events=module.transition(state,{'ready':False,'live':True},str(index))
 assert events==[]
state,events=module.transition(state,{'ready':False,'live':True},'3')
assert events==[{'at':'3','check':'ready','state':'ALERT'}]
state,events=module.transition(state,{'ready':False,'live':True},'4')
assert events==[]
state,events=module.transition(state,{'ready':True,'live':True},'5')
assert events==[{'at':'5','check':'ready','state':'RECOVERED'}]
assert state['readyFailures']==0
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE:'1'} });
  assert.equal(result.status, 0, result.stderr);
});

import assert from 'node:assert/strict';import {providerDiagnostics} from './provider-diagnostics.mjs';
const secret='PRIVATE_SECRET_NonSchemaText';
const d=providerDiagnostics({body:JSON.stringify({error:{type:'invalid_request_error',code:secret,param:'input[2].content',message:'Invalid input_text; expected output_text '+secret}})},{input:[{type:'message',role:'user',content:secret}],tools:[{name:'analyze_image'}]});
assert.ok(!JSON.stringify(d).includes(secret));assert.equal(d.provider_code,null);assert.equal(d.provider_type,'invalid_request_error');assert.equal(d.provider_param,'input[2].content');assert.ok(d.error_tokens.includes('output_text'));assert.equal(d.request_shape.items[0].content_chars,secret.length);
const unknown=providerDiagnostics({body:'not json',message:secret},{input:[]});assert.ok(!JSON.stringify(unknown).includes(secret));console.log('PASS closed-vocabulary diagnostics exclude raw errors, chat contents and arbitrary codes');

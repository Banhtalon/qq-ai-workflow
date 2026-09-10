import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {ENTRY_POINT_FILES,REFERENCE_GUIDANCE_FILES,guidanceRuleDriftTerms} from "../scripts/lib/documentation.mjs";

const workspace=resolve(dirname(fileURLToPath(import.meta.url)),"..");

test("entry points exactly match their approved fixtures",()=>{
 for(const relative of ENTRY_POINT_FILES){
  const actual=readFileSync(join(workspace,relative),"utf8");
  const fixture=readFileSync(join(workspace,"test/fixtures/reference-entrypoints",relative),"utf8");
  assert.equal(actual,fixture,relative);
 }
});

test("reference-only guidance has no rule-language signals",()=>{
 for(const relative of REFERENCE_GUIDANCE_FILES){
  const contents=readFileSync(join(workspace,relative),"utf8");
  assert.deepEqual(guidanceRuleDriftTerms(contents),[],relative);
 }
});

test("rule-language detector warns about a guide that appears to add policy",()=>{
 assert.deepEqual(
  guidanceRuleDriftTerms("This guide must never override a required workflow rule. Không được tự bỏ qua gate."),
  ["must","never","required","không được"]
 );
});

test("canonical spec owns elevated review and repair-budget rules",()=>{
 const canonical=readFileSync(join(workspace,".ai-workflow/V10_CANONICAL_SPEC.md"),"utf8");
 const bridge=readFileSync(join(workspace,".ai-workflow/CLI_BRIDGE.md"),"utf8");
 assert.match(canonical,/An elevated-risk review records completed risk checks/u);
 assert.match(canonical,/Two repair rounds at the initial tier/u);
 assert.doesNotMatch(bridge,/Two repair rounds at the initial tier/u);
});

test("canonical spec owns Fast Lane and LOCAL_AUTO conditions",()=>{
 const canonical=readFileSync(join(workspace,".ai-workflow/V10_CANONICAL_SPEC.md"),"utf8");
 assert.match(canonical,/Fast Lane only routes a clean documentation-only candidate/u);
 assert.match(canonical,/deterministic quota drill/u);
});

import {readFile} from "node:fs/promises";
import path from "node:path";

const VERSION_PATTERN=/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const VERSION_FILES=Object.freeze([
 {label:"VERSION",relative:"VERSION",kind:"file"},
 {label:"package.json",relative:"package.json",kind:"package"},
 {label:"README.md",relative:"README.md",kind:"readme"},
 {label:".ai-workflow/V10_CANONICAL_SPEC.md",relative:".ai-workflow/V10_CANONICAL_SPEC.md",kind:"spec"}
]);

function scalar(content){
 const value=String(content??"").trim();
 return value&&/^\S+$/u.test(value)?value:null;
}

function marker(content,pattern){return String(content??"").match(pattern)?.[1]??null;}

export function extractCurrentVersions({versionFile,packageJsonText,readmeText,specText}){
 let packageJson;
 try{packageJson=JSON.parse(String(packageJsonText??""));}
 catch(error){throw new Error(`package.json is not valid JSON: ${error.message}`);}
 return {
  VERSION:scalar(versionFile),
  "package.json":typeof packageJson?.version==="string"?scalar(packageJson.version):null,
  "README.md":marker(readmeText,/^Version:\s*\*\*([^\s*]+)\*\*/mu),
  ".ai-workflow/V10_CANONICAL_SPEC.md":marker(specText,/^Version\s+([^\s(]+)/mu)
 };
}

export function assertCurrentVersionConsistency(versions){
 const labels=VERSION_FILES.map(({label})=>label);
 const invalid=labels.filter(label=>!VERSION_PATTERN.test(versions?.[label]??""));
 const expected=versions?.VERSION??null;
 const mismatched=labels.filter(label=>versions?.[label]!==expected);
 if(invalid.length||mismatched.length){
  const details=labels.map(label=>`${label}=${versions?.[label]??"<missing>"}`).join(", ");
  const reason=[
   invalid.length?`invalid or missing marker(s): ${invalid.join(", ")}`:null,
   mismatched.length?"current markers do not agree":null
  ].filter(Boolean).join("; ");
  throw new Error(`current version consistency check failed (${reason}): ${details}`);
 }
 return {version:expected,versions};
}

export async function assertCurrentVersionFiles(root){
 const contents={};
 for(const file of VERSION_FILES)contents[file.kind]=await readFile(path.join(root,file.relative),"utf8");
 const versions=extractCurrentVersions({
  versionFile:contents.file,
  packageJsonText:contents.package,
  readmeText:contents.readme,
  specText:contents.spec
 });
 return assertCurrentVersionConsistency(versions);
}

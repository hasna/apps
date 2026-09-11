import type {Project} from "../types/index.js";
function same(a:unknown,b:unknown):boolean {
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>same(value,b[index]));
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
 const keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
}
export function assertProjectReceipt(raw:unknown,expected:Record<string,unknown>={}):Project {
 const value=raw&&typeof raw==='object'&&!Array.isArray(raw)&&'project' in raw?(raw as {project:unknown}).project:raw;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error("Invalid project receipt");
 const project=value as Record<string,unknown>;
 if(typeof project.id!=='string'||!project.id||typeof project.name!=='string'||!project.name||typeof project.path!=='string'||!project.path)throw new Error("Invalid project receipt");
 for(const [field,requested]of Object.entries(expected))if(requested!==undefined&&!same(project[field],requested))throw new Error("Project API did not confirm the requested identity or fields; no success receipt accepted");
 return project as unknown as Project;
}

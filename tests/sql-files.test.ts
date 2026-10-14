import test from "node:test";
import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";

// Static regression check only; real PostgreSQL/RLS tests run in Supabase.
test("SQL files retain paired dollar quotes and valid DO block delimiters",async()=>{
 for(const directory of ["migrations","tests"]) {
  const base=new URL(`../supabase/${directory}/`,import.meta.url);
  for(const name of await readdir(base)) {
   if(!name.endsWith(".sql")) continue;
   const sql=await readFile(new URL(name,base),"utf8");
   assert.equal((sql.match(/\$\$/g)??[]).length%2,0,`${name}: unpaired dollar quotes`);
   assert.doesNotMatch(sql,/\bdo\s+\$(?!\$)/i,`${name}: broken DO delimiter`);
  }
 }
});

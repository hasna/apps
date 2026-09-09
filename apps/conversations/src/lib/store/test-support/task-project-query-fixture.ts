// Test-only SQL emulation for existing task/project HTTP handlers. It shares the
// parent fixture's rows; it is not a database adapter or PostgreSQL/RLS evidence.
export function taskProjectQueries(tasks: any[], projects: Record<string, any>, channels: Record<string, any>) {
  let nextTaskId = 1;
  const comments: any[] = [];
  const activity: any[] = [];
  const clone = (value: any) => structuredClone(value);
  const stamp = () => new Date().toISOString();
  const deps = (id: unknown) => tasks.find(t => Number(t.id) === Number(id))?.depends_on ?? [];
  const dependencyRows = (id: unknown) => deps(id).map((dep: number) => tasks.find(t => Number(t.id) === Number(dep))).filter(Boolean);
  const snapshot = () => clone({ comments, activity });
  const restore = (state: ReturnType<typeof snapshot>) => { comments.splice(0, comments.length, ...state.comments); activity.splice(0, activity.length, ...state.activity); };
  const assignment = (sql: string, params: readonly unknown[], row: any) => {
    const source = sql.match(/ SET (.*?) WHERE /is)?.[1];
    if (!source) throw new Error("Task fixture assignment is missing");
    for (const entry of source.split(/,\s*/)) {
      const match = entry.match(/^(\w+)\s*=\s*(\$\d+|'[^']*'|NULL)$/i);
      if (!match) throw new Error("Task fixture assignment is unsupported");
      const raw = match[2];
      let value = raw.startsWith('$') ? params[Number(raw.slice(1)) - 1] : raw.toUpperCase() === 'NULL' ? null : raw.slice(1,-1);
      if (match[1] === 'depends_on' && typeof value === 'string') value = JSON.parse(value);
      row[match[1]] = value;
    }
  };
  function many(sql: string, p: readonly unknown[]): any[] | undefined {
    if (/FROM task_comments/i.test(sql)) {
      if (/GROUP BY task_id/i.test(sql)) return (p[0] as number[]).map(id => ({ task_id: id, c: comments.filter(c => c.task_id === id).length }));
      return comments.filter(c => c.task_id === Number(p[0])).map(clone);
    }
    if (/FROM task_activity/i.test(sql)) return activity.filter(a => a.task_id === Number(p[0])).slice().reverse().slice(0, Number(sql.match(/LIMIT (\d+)/i)?.[1] ?? 1000)).map(clone);
    if (/SELECT depends_on_id FROM task_dependencies/i.test(sql)) return deps(p[0]).map((id: number) => ({ depends_on_id: id }));
    if (/SELECT t\.\* FROM tasks t INNER JOIN task_dependencies/i.test(sql)) {
      return /WHERE td\.task_id =/i.test(sql) ? dependencyRows(p[0]).map(clone) : tasks.filter(t => deps(t.id).includes(Number(p[0]))).map(clone);
    }
    if (/FROM tasks WHERE parent_id = ANY/i.test(sql)) return (p[0] as number[]).map(id => ({ parent_id: id, c: tasks.filter(t => t.parent_id === id).length }));
    if (/FROM task_dependencies td JOIN tasks dt/i.test(sql)) {
      return (p[0] as number[]).flatMap(id => dependencyRows(id).map((t: any) => ({ task_id: id, dep_id: t.id, subject: t.subject, status: t.status })));
    }
    if (!/FROM tasks(?:\s+WHERE|\s+ORDER|\s*$)/i.test(sql)) return undefined;
    let rows = tasks.slice();
    for (const match of sql.matchAll(/\b(status|assignee|reporter|project_id|channel|priority|parent_id|id) = \$(\d+)/g)) rows = rows.filter(t => String(t[match[1]]) === String(p[Number(match[2])-1]));
    if (/parent_id IS NULL/i.test(sql)) rows = rows.filter(t => t.parent_id == null);
    if (/status <> 'cancelled'/i.test(sql)) rows = rows.filter(t => t.status !== 'cancelled');
    const tag = sql.match(/tags LIKE \$(\d+)/i);
    if (tag) rows = rows.filter(t => String(t.tags ?? '').includes(String(p[Number(tag[1])-1]).replaceAll('%','')));
    if (/ORDER BY CASE priority/i.test(sql)) rows.sort((a,b) => ['critical','high','medium','low'].indexOf(a.priority)-['critical','high','medium','low'].indexOf(b.priority) || String(b.created_at).localeCompare(String(a.created_at)));
    const limit = sql.match(/LIMIT \$(\d+)/i); const offset = sql.match(/OFFSET \$(\d+)/i);
    return rows.slice(offset ? Number(p[Number(offset[1])-1]) : 0, limit ? (offset ? Number(p[Number(offset[1])-1]) : 0) + Number(p[Number(limit[1])-1]) : undefined).map(clone);
  }
  function get(sql: string, p: readonly unknown[]): any | undefined {
    if (/INSERT INTO projects/i.test(sql)) {
      const [id,name,description,path,repository,created_by,metadata,tags,settings] = p;
      if (Object.values(projects).some(row=>row.name===name)) throw Object.assign(new Error("Duplicate project"), {code:"23505"});
      const row={id,name,description,path,repository,created_by,status:"active",created_at:stamp(),metadata:metadata??null,tags:tags??null,settings:settings??null};
      projects[String(id)] = row; return clone(row);
    }
    if (/INSERT INTO tasks /i.test(sql)) {
      const names = ['uuid','subject','description','reporter','assignee','priority','project_id','channel','parent_id','tags','metadata','due_at'];
      const row: any = { id: Math.max(nextTaskId,...tasks.map(t => Number(t.id)+1)), status:'pending', depends_on:[], created_at:stamp(), started_at:null, completed_at:null, cancelled_at:null };
      names.forEach((name,i)=>row[name]=p[i]); nextTaskId=row.id+1; tasks.push(row); return { id:row.id };
    }
    if (/INSERT INTO task_comments/i.test(sql)) { const row={id:comments.length+1,task_id:Number(p[0]),agent:p[1],content:p[2],created_at:stamp()}; comments.push(row); return clone(row); }
    if (/SELECT COUNT\(\*\)::int AS c FROM task_comments/i.test(sql)) return {c:comments.filter(c=>c.task_id===Number(p[0])).length};
    if (/SELECT 1 FROM task_dependencies/i.test(sql)) return dependencyRows(p[0]).some((t:any)=>t.status!=='completed') ? {'?column?':1} : null;
    if (/SELECT COUNT\(\*\)::int AS c FROM tasks WHERE parent_id = \$1/i.test(sql)) return {c: tasks.filter(t=>t.parent_id===Number(p[0])).length};
    if (/SELECT .*FROM tasks WHERE id = \$1/is.test(sql)) return clone(tasks.find(t=>Number(t.id)===Number(p[0]))??null);
    if (/SELECT id FROM tasks WHERE uuid = \$1/i.test(sql)) return clone(tasks.find(t=>t.uuid===p[0])??null);
    if (/SELECT id FROM projects WHERE name = \$1/i.test(sql)) return clone(Object.values(projects).find(t=>t.name===p[0])??null);
    if (/FROM projects p WHERE p.id = \$1 OR p.name = \$1/i.test(sql)) { const row=Object.values(projects).find(t=>t.id===p[0]||t.name===p[0]);return row?{...clone(row),channel_count:Object.values(channels).filter(c=>c.project_id===row.id).length}:null; }
    if (/UPDATE projects SET/i.test(sql)) { const row=projects[String(p.at(-1))]; if(!row)return null; assignment(sql,p,row); return clone(row); }
    if (/DELETE FROM projects WHERE id = \$1 RETURNING id/i.test(sql)) { const id=String(p[0]);if(!projects[id])return null;if(Object.values(channels).some(row=>row.project_id===id)||tasks.some(row=>row.project_id===id))throw Object.assign(new Error('Project referenced'),{code:'23503'});delete projects[id];return {id}; }
    return undefined;
  }
  function query(sql: string, p: readonly unknown[]): {rows:any[];rowCount:number} | undefined {
    if (/INSERT INTO task_activity/i.test(sql)) { activity.push({id:activity.length+1,task_id:Number(p[0]),agent:p[1],action:p[2],detail:p[3],created_at:stamp()}); return {rows:[],rowCount:1}; }
    if (/INSERT INTO task_dependencies/i.test(sql)) {const row=tasks.find(t=>Number(t.id)===Number(p[0]));if(!row)throw new Error('Task missing');row.depends_on??=[];if(!row.depends_on.includes(Number(p[1])))row.depends_on.push(Number(p[1]));return {rows:[],rowCount:1};}
    if (/DELETE FROM task_dependencies/i.test(sql)) {const row=tasks.find(t=>Number(t.id)===Number(p[0]));if(!row)return {rows:[],rowCount:0};const previous=row.depends_on.length;row.depends_on=row.depends_on.filter((id:number)=>id!==Number(p[1]));return {rows:[],rowCount:previous-row.depends_on.length};}
    if (/UPDATE tasks SET (?:status|priority|assignee|depends_on)/i.test(sql)) {const row=tasks.find(t=>Number(t.id)===Number(p.at(-1)));if(!row)return {rows:[],rowCount:0};assignment(sql,p,row);return {rows:[],rowCount:1};}
    if (/DELETE FROM tasks WHERE id = \$1/i.test(sql)) {const i=tasks.findIndex(t=>Number(t.id)===Number(p[0]));if(i<0)return {rows:[],rowCount:0};tasks.splice(i,1);return {rows:[],rowCount:1};}
    return undefined;
  }
  return {many,get,query,snapshot,restore};
}

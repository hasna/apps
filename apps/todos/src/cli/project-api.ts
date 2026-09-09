import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Plan, Project } from "../types/index.js";
import { cloudQueryBlockingDeps, cloudQueryTasks } from "./task-query-api.js";
import { renderTodosProjectPanel } from "../lib/project-panel.js";

export async function cloudProjectPanel(client:HasnaStorageClient,project:Project,limit:number) {
  const tasks=(await cloudQueryTasks(client,{project_id:project.id,include_subtasks:true})).filter(task=>!task.archived_at);
  if(tasks.length>1000)throw new Error("Project panel exceeds the bounded 1000-task dependency scan; no incomplete panel returned");
  const raw=await client.transport.get<{plans:Plan[];count:number}>(`/plans?project_id=${encodeURIComponent(project.id)}`);
  if(!raw || !Array.isArray(raw.plans) || raw.count!==raw.plans.length || raw.plans.some(plan=>!plan || typeof plan.id!=="string" || plan.project_id!==project.id))throw new Error("Project plans returned an incomplete or incorrectly scoped receipt");
  const planNames=new Map(raw.plans.map(plan=>[plan.id,plan.name]));
  for(const task of tasks) if(task.plan_id && !planNames.has(task.plan_id)) {
    const value=await client.get<unknown>("plans",task.plan_id);
    const plan=value && typeof value==='object' && 'plan' in value?(value as {plan:Plan}).plan:value as Plan;
    if(!plan || plan.id!==task.plan_id)throw new Error("Task plan unavailable; cannot render complete project panel");
    planNames.set(plan.id,plan.name);
  }
  const blockers=await cloudQueryBlockingDeps(client,tasks);
  return renderTodosProjectPanel(project,tasks,raw.plans,blockers,{limit,planNames});
}

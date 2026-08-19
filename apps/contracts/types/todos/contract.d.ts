import { TODOS_CONTRACT_SCHEMA_ID, TODOS_CONTRACT_SCHEMAS, TodosContractDescriptorSchema, type TodosContractDescriptor } from "./contract-schema";
export declare const TODOS_CONTRACT_DESCRIPTOR: TodosContractDescriptor;
export declare const TODOS_CONTRACT_DIGEST: string;
export declare function verifyTodosContractDigests(): boolean;
export declare function validateTodosContractDescriptor(input: unknown): input is TodosContractDescriptor;
export { TODOS_CONTRACT_SCHEMA_ID, TODOS_CONTRACT_SCHEMAS, TodosContractDescriptorSchema, };
export type { TodosContractDescriptor, };

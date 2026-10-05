/** HTTP contracts shared by the service and dashboard. Money is integer USD cents. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type WorkerId = 'researcher' | 'creator' | 'reviewer' | 'operator' | 'treasury';
export interface Worker {
  id: WorkerId;
  name: string;
  role: string;
  position: string;
  department: string;
  manager_id: WorkerId | 'owner';
  kind: 'agent' | 'control';
  purpose: string;
  permissions: string[];
  restrictions: string[];
}
export interface FunctionDefinition {
  id: string;
  title: string;
  worker_id: WorkerId;
  engine: 'scripted' | 'control';
  inputs: string[];
  outputs: string[];
  depends_on: string[];
  source: string;
}
export interface Company {
  id: number;
  mode: 'simulation';
  paused: number;
  auto_enabled: number;
  next_tick: number;
  reserve_minor: number;
  action_limit_minor: number;
  daily_limit_minor: number;
  policy_version: number;
  created_at: number;
}
export interface Balance extends Company {
  cash_minor: number;
  reserved_minor: number;
  refund_buffer_minor: number;
  available_minor: number;
  profit_minor: number;
  revenue_minor: number;
  expenses_minor: number;
  spent_today_minor: number;
}
export interface Envelope {
  id: string;
  label: string;
  budget_minor: number;
  spent_minor: number;
  reserved_minor: number;
  remaining_minor: number;
}
export interface Product {
  id: string;
  title: string;
  audience: string;
  price_minor: number;
  delivery_cost_minor: number;
  color: string;
}
export interface Order {
  id: string;
  product_id: string;
  gross_minor: number;
  cost_minor: number;
  status: 'delivered' | 'refunded';
  refund_until: number;
  created_at: number;
  title: string;
}
export interface Action {
  id: string;
  title: string;
  envelope_id: string;
  amount_minor: number;
  status: 'reserved' | 'completed' | 'cancelled';
  created_at: number;
  completed_at: number | null;
}
export interface CompanyEvent {
  id: number;
  kind: string;
  actor: string;
  title: string;
  detail: string;
  reference: string | null;
  created_at: number;
}
export interface JournalLine {
  account: 'cash' | 'equity' | 'revenue' | 'expense';
  amount_minor: number;
}
export interface Transaction {
  id: string;
  kind: string;
  description: string;
  reference: string | null;
  envelope_id: string | null;
  created_at: number;
  lines: JournalLine[];
}
export interface Span {
  id: string;
  run_id: string;
  parent_id: string | null;
  worker_id: WorkerId;
  worker_name: string;
  position: string;
  function_id: string;
  function_title: string;
  engine: 'scripted' | 'control';
  provider: 'local';
  destination: 'local-process';
  model: null;
  status: 'completed' | 'blocked';
  inputs: Json;
  outputs: Json;
  duration_ms: number;
  input_tokens: null;
  output_tokens: null;
  cost_micro_usd: number;
  created_at: number;
}
export interface Run {
  id: string;
  workflow: string;
  status: 'completed' | 'blocked';
  order_id: string | null;
  product_id: string;
  product_title: string;
  engine: 'scripted';
  created_at: number;
  spans: Span[];
}
export interface Inspector {
  registry_version: number;
  workers: (Worker & {
    enabled: boolean;
    execution_count: number;
    duration_ms: number;
    function_ids: string[];
  })[];
  functions: FunctionDefinition[];
  runs: Run[];
  totals: {
    executions: number;
    duration_ms: number;
    model_calls: number;
    model_cost_micro_usd: number;
    input_tokens: number;
    output_tokens: number;
  };
  routing: {
    function_id: string;
    worker_id: WorkerId;
    engine: 'scripted' | 'control';
    provider: 'local';
    destination: 'local-process';
    model: null;
    external_inference_enabled: false;
  }[];
}
export interface State {
  company: Balance & { order_count: number; refund_count: number; policy_healthy: boolean };
  envelopes: Envelope[];
  roles: Worker[];
  products: (Product & { orders: number; contribution_minor: number })[];
  orders: Order[];
  actions: Action[];
  events: CompanyEvent[];
  ledger: Transaction[];
  server_time: number;
  capabilities: {
    real_world_execution: false;
    llm_agents: false;
    simulator: 'scripted';
    profit_target_minor: number;
  };
}
export type DashboardState = State & { inspector: Inspector };
export interface CommandResult {
  message: string;
  order_id?: string;
  run_id?: string;
  action_id?: string;
}

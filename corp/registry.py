"""Versioned worker and function registry: the company's actual execution map."""

WORKERS = [
    {"id": "researcher", "name": "Scout", "role": "Research", "position": "Market research analyst", "department": "Strategy", "manager_id": "operator", "kind": "agent", "purpose": "Select a product hypothesis for a scripted scenario.", "permissions": ["Read product concepts", "Select scenario product"], "restrictions": ["No external research or outreach", "Cannot spend or post revenue"]},
    {"id": "creator", "name": "Studio", "role": "Product creation", "position": "Digital product designer", "department": "Production", "manager_id": "operator", "kind": "agent", "purpose": "Prepare a scenario delivery specification, not a real asset.", "permissions": ["Prepare delivery specification"], "restrictions": ["No generated files or external models", "Cannot certify its own quality"]},
    {"id": "reviewer", "name": "Review", "role": "Quality", "position": "Quality assurance reviewer", "department": "Production", "manager_id": "operator", "kind": "agent", "purpose": "Validate scenario prices, costs, and delivery metadata.", "permissions": ["Validate delivery specification", "Block invalid specifications"], "restrictions": ["Cannot alter spending policy", "Cannot certify real products"]},
    {"id": "operator", "name": "Operator", "role": "Business operations", "position": "Digital business manager", "department": "Operations", "manager_id": "owner", "kind": "agent", "purpose": "Coordinate simulated orders, delivery, and settlement.", "permissions": ["Run permitted scenario workflows", "Request ledger posting through Treasury"], "restrictions": ["No live accounts or payments", "Cannot bypass treasury checks"]},
    {"id": "treasury", "name": "Treasury", "role": "Financial control", "position": "Deterministic finance and policy service", "department": "Controls", "manager_id": "owner", "kind": "control", "purpose": "Enforce financial limits and post balanced journal entries.", "permissions": ["Authorize bounded virtual costs", "Post balanced entries", "Block unsafe commitments"], "restrictions": ["No LLM authority", "Protected reserve cannot be disabled"]},
]

FUNCTIONS = [
    {"id": "select_product", "title": "Select product hypothesis", "worker_id": "researcher", "engine": "scripted", "inputs": ["Product identifier", "Product catalog"], "outputs": ["Scenario product metadata"], "depends_on": [], "source": "corp/service.py · _cycle"},
    {"id": "authorize_budget", "title": "Authorize production budget", "worker_id": "treasury", "engine": "control", "inputs": ["Maximum scenario cost", "Cash, holds and limits"], "outputs": ["Permission or policy denial"], "depends_on": ["select_product"], "source": "corp/treasury.py · authorize"},
    {"id": "prepare_delivery", "title": "Prepare delivery specification", "worker_id": "creator", "engine": "scripted", "inputs": ["Scenario product metadata"], "outputs": ["Price, cost and simulation-only specification"], "depends_on": ["authorize_budget"], "source": "corp/workflows.py · prepare_delivery"},
    {"id": "check_delivery", "title": "Validate delivery specification", "worker_id": "reviewer", "engine": "control", "inputs": ["Delivery specification"], "outputs": ["Validated specification or rejection"], "depends_on": ["prepare_delivery"], "source": "corp/workflows.py · check_delivery"},
    {"id": "settle_order", "title": "Deliver and settle virtual order", "worker_id": "operator", "engine": "scripted", "inputs": ["Validated specification"], "outputs": ["Virtual order and settlement reference"], "depends_on": ["check_delivery"], "source": "corp/service.py · _cycle"},
    {"id": "post_ledger", "title": "Post balanced financial entries", "worker_id": "treasury", "engine": "control", "inputs": ["Virtual settlement and scenario costs"], "outputs": ["Sale and expense journal entries"], "depends_on": ["settle_order"], "source": "corp/treasury.py · post"},
]

WORKER_BY_ID = {worker["id"]: worker for worker in WORKERS}
FUNCTION_BY_ID = {function["id"]: function for function in FUNCTIONS}
AGENT_ROLES = [worker for worker in WORKERS if worker["kind"] == "agent"]

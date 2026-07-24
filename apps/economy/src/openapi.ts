// @generated mirror of openapi/economy.json — the serve OpenAPI (SDK source).
// Edit openapi/economy.json, then regenerate:  bun scripts/sync-openapi.ts
export const openApiSpec: Record<string, unknown> = {
  "openapi": "3.0.3",
  "info": {
    "title": "@hasna/economy self-hosted API",
    "version": "0.0.0",
    "description": "AI coding cost tracker — self-hosted control plane. Cloud mode is PURE REMOTE per Amendment A1: the serve process reads/writes the shared RDS Postgres directly with API-key auth via @hasna/contracts. All /v1 routes require a valid `economy:*` scoped API key (x-api-key or Authorization: Bearer). The foundation probes /health, /ready, /version are open."
  },
  "servers": [
    {
      "url": "https://economy.hasna.xyz",
      "description": "prod"
    },
    {
      "url": "http://localhost:3456",
      "description": "local"
    }
  ],
  "security": [
    {
      "apiKey": []
    },
    {
      "bearer": []
    }
  ],
  "components": {
    "securitySchemes": {
      "apiKey": {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key"
      },
      "bearer": {
        "type": "http",
        "scheme": "bearer"
      }
    },
    "schemas": {
      "Envelope": {
        "type": "object",
        "properties": {
          "data": {},
          "meta": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "required": [
          "data"
        ]
      },
      "Foundation": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "mode": {
            "type": "string"
          },
          "service": {
            "type": "string"
          }
        },
        "required": [
          "status",
          "version",
          "mode"
        ]
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "message": {
            "type": "string"
          }
        },
        "required": [
          "error"
        ]
      },
      "MutationOk": {
        "type": "object",
        "properties": {
          "ok": {
            "type": "boolean"
          }
        }
      },
      "CostSummary": {
        "type": "object",
        "properties": {
          "total_cost_usd": {
            "type": "number"
          },
          "total_tokens": {
            "type": "number"
          },
          "request_count": {
            "type": "number"
          },
          "session_count": {
            "type": "number"
          },
          "period": {
            "type": "string"
          }
        },
        "additionalProperties": true
      },
      "Session": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "agent": {
            "type": "string"
          },
          "project_path": {
            "type": "string"
          },
          "project_name": {
            "type": "string"
          },
          "started_at": {
            "type": "string"
          },
          "ended_at": {
            "type": "string",
            "nullable": true
          },
          "total_cost_usd": {
            "type": "number"
          },
          "total_tokens": {
            "type": "number"
          },
          "request_count": {
            "type": "number"
          }
        },
        "additionalProperties": true
      },
      "ModelBreakdown": {
        "type": "object",
        "additionalProperties": true
      },
      "ProjectBreakdown": {
        "type": "object",
        "additionalProperties": true
      },
      "AgentBreakdown": {
        "type": "object",
        "additionalProperties": true
      },
      "AccountBreakdown": {
        "type": "object",
        "additionalProperties": true
      },
      "DailyPoint": {
        "type": "object",
        "additionalProperties": true
      },
      "BudgetStatus": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "limit_usd": {
            "type": "number"
          },
          "period": {
            "type": "string"
          },
          "spent_usd": {
            "type": "number"
          }
        },
        "additionalProperties": true
      },
      "CreateBudgetInput": {
        "type": "object",
        "properties": {
          "limit_usd": {
            "type": "number"
          },
          "alert_at_percent": {
            "type": "number"
          },
          "period": {
            "type": "string",
            "enum": [
              "daily",
              "weekly",
              "monthly",
              "day",
              "week",
              "month"
            ]
          },
          "project_path": {
            "type": "string",
            "nullable": true
          },
          "agent": {
            "type": "string",
            "nullable": true
          }
        },
        "required": [
          "limit_usd"
        ]
      },
      "GoalStatus": {
        "type": "object",
        "additionalProperties": true
      },
      "CreateGoalInput": {
        "type": "object",
        "properties": {
          "period": {
            "type": "string",
            "enum": [
              "day",
              "week",
              "month",
              "year"
            ]
          },
          "limit_usd": {
            "type": "number"
          },
          "project_path": {
            "type": "string",
            "nullable": true
          },
          "agent": {
            "type": "string",
            "nullable": true
          }
        },
        "required": [
          "limit_usd"
        ]
      },
      "ModelPricing": {
        "type": "object",
        "additionalProperties": true
      },
      "CreatePricingInput": {
        "type": "object",
        "properties": {
          "model": {
            "type": "string"
          },
          "input_per_1m": {
            "type": "number"
          },
          "output_per_1m": {
            "type": "number"
          }
        },
        "required": [
          "model",
          "input_per_1m",
          "output_per_1m"
        ]
      },
      "Subscription": {
        "type": "object",
        "additionalProperties": true
      },
      "CreateSubscriptionInput": {
        "type": "object",
        "properties": {
          "provider": {
            "type": "string"
          },
          "plan": {
            "type": "string"
          },
          "monthly_fee_usd": {
            "type": "number"
          },
          "included_usage_usd": {
            "type": "number"
          },
          "agent": {
            "type": "string",
            "nullable": true
          }
        },
        "required": [
          "provider",
          "plan"
        ]
      },
      "Project": {
        "type": "object",
        "additionalProperties": true
      },
      "CreateProjectInput": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "path"
        ]
      },
      "MachineInfo": {
        "type": "object",
        "additionalProperties": true
      },
      "BillingSummary": {
        "type": "object",
        "additionalProperties": true
      }
    }
  },
  "paths": {
    "/health": {
      "get": {
        "operationId": "health",
        "summary": "Liveness probe",
        "security": [],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Foundation"
                }
              }
            }
          }
        }
      }
    },
    "/ready": {
      "get": {
        "operationId": "ready",
        "summary": "Readiness probe (storage reachable + migrated)",
        "security": [],
        "responses": {
          "200": {
            "description": "ready",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Foundation"
                }
              }
            }
          },
          "503": {
            "description": "not ready",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Foundation"
                }
              }
            }
          }
        }
      }
    },
    "/version": {
      "get": {
        "operationId": "version",
        "summary": "Version probe",
        "security": [],
        "responses": {
          "200": {
            "description": "version",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Foundation"
                }
              }
            }
          }
        }
      }
    },
    "/v1/summary": {
      "get": {
        "operationId": "getSummary",
        "summary": "Cost summary for a period",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/CostSummary"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/sessions": {
      "get": {
        "operationId": "listSessions",
        "summary": "List sessions",
        "parameters": [
          {
            "name": "agent",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "project",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "account",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "since",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "fields",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Session"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/sessions/{id}/requests": {
      "get": {
        "operationId": "getSessionRequests",
        "summary": "Requests for a session",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          },
          "404": {
            "description": "not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/v1/top": {
      "get": {
        "operationId": "topSessions",
        "summary": "Top sessions by cost",
        "parameters": [
          {
            "name": "n",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "agent",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "since",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Session"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/models": {
      "get": {
        "operationId": "modelBreakdown",
        "summary": "Cost by model",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/ModelBreakdown"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/projects": {
      "get": {
        "operationId": "projectBreakdown",
        "summary": "Cost by project",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/ProjectBreakdown"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/accounts": {
      "get": {
        "operationId": "accountBreakdown",
        "summary": "Cost by account",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/AccountBreakdown"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/breakdown": {
      "get": {
        "operationId": "breakdown",
        "summary": "Cost breakdown by dimension",
        "parameters": [
          {
            "name": "by",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "model",
                "project",
                "agent",
                "account"
              ]
            }
          },
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/daily": {
      "get": {
        "operationId": "daily",
        "summary": "Daily cost points",
        "parameters": [
          {
            "name": "days",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/DailyPoint"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/hourly": {
      "get": {
        "operationId": "hourly",
        "summary": "Hourly cost points",
        "parameters": [
          {
            "name": "hours",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/machines": {
      "get": {
        "operationId": "listMachines",
        "summary": "Known machines",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/MachineInfo"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/fleet": {
      "get": {
        "operationId": "fleet",
        "summary": "Fleet summary",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "machine",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/billing": {
      "get": {
        "operationId": "billing",
        "summary": "Provider billing summary",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/BillingSummary"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/billing/diff": {
      "get": {
        "operationId": "billingDiff",
        "summary": "Billing vs tracked diff",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "threshold",
            "in": "query",
            "schema": {
              "type": "number"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/usage": {
      "get": {
        "operationId": "usage",
        "summary": "Usage snapshots + summary",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "agent",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/savings": {
      "get": {
        "operationId": "savings",
        "summary": "Savings summary",
        "parameters": [
          {
            "name": "period",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "agent",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/budgets": {
      "get": {
        "operationId": "listBudgets",
        "summary": "List budgets",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/BudgetStatus"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "createBudget",
        "summary": "Create a budget",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateBudgetInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/BudgetStatus"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/budgets/{id}": {
      "delete": {
        "operationId": "deleteBudget",
        "summary": "Delete a budget",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MutationOk"
                }
              }
            }
          }
        }
      }
    },
    "/v1/goals": {
      "get": {
        "operationId": "listGoals",
        "summary": "List goals",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/GoalStatus"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "createGoal",
        "summary": "Create a goal",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateGoalInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/GoalStatus"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/goals/{id}": {
      "delete": {
        "operationId": "deleteGoal",
        "summary": "Delete a goal",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MutationOk"
                }
              }
            }
          }
        }
      }
    },
    "/v1/pricing": {
      "get": {
        "operationId": "listPricing",
        "summary": "List model pricing",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/ModelPricing"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "upsertPricing",
        "summary": "Upsert model pricing",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreatePricingInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/ModelPricing"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/pricing/{model}": {
      "delete": {
        "operationId": "deletePricing",
        "summary": "Delete model pricing",
        "parameters": [
          {
            "name": "model",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MutationOk"
                }
              }
            }
          }
        }
      }
    },
    "/v1/subscriptions": {
      "get": {
        "operationId": "listSubscriptions",
        "summary": "List subscriptions",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Subscription"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "upsertSubscription",
        "summary": "Upsert a subscription",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateSubscriptionInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/Subscription"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/subscriptions/{id}": {
      "delete": {
        "operationId": "deleteSubscription",
        "summary": "Delete a subscription",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MutationOk"
                }
              }
            }
          }
        }
      }
    },
    "/v1/project-registry": {
      "get": {
        "operationId": "listProjectRegistry",
        "summary": "List registered projects",
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Project"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "upsertProject",
        "summary": "Register a project",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateProjectInput"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MutationOk"
                }
              }
            }
          }
        }
      }
    },
    "/v1/project-registry/{id}": {
      "delete": {
        "operationId": "deleteProject",
        "summary": "Delete a registered project",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/MutationOk"
                }
              }
            }
          }
        }
      }
    },
    "/v1/sync": {
      "post": {
        "operationId": "sync",
        "summary": "Trigger an ingest sync",
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "sources": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    },
    "/v1/ingest": {
      "post": {
        "operationId": "ingest",
        "summary": "Bulk-import local rows into the cloud DB (merge by primary key, idempotent)",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "requests": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "sessions": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "projects": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "budgets": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "goals": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "billing_daily": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "model_pricing": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "subscriptions": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "usage_snapshots": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ok",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Envelope"
                }
              }
            }
          }
        }
      }
    }
  }
}
export default openApiSpec

local M = {}

local function run_todos(args, on_result)
  vim.system(vim.list_extend({ "todos", "--json" }, args), { text = true }, function(result)
    if result.code ~= 0 then
      vim.schedule(function()
        vim.notify(result.stderr, vim.log.levels.ERROR)
      end)
      return
    end
    local ok, payload = pcall(vim.json.decode, result.stdout)
    if not ok then
      vim.schedule(function()
        vim.notify("todos returned invalid JSON", vim.log.levels.ERROR)
      end)
      return
    end
    vim.schedule(function()
      on_result(payload)
    end)
  end)
end

function M.ready_to_quickfix()
  run_todos({ "ready" }, function(tasks)
    local items = {}
    for _, task in ipairs(tasks or {}) do
      table.insert(items, {
        text = string.format("[%s] %s", task.priority or "medium", task.title),
        valid = 1,
      })
    end
    vim.fn.setqflist(items, "r")
    vim.cmd("copen")
  end)
end

function M.statusline()
  run_todos({ "status" }, function(status)
    vim.g.todos_statusline = string.format(
      "todos p:%s i:%s c:%s",
      status.pending or 0,
      status.in_progress or 0,
      status.completed or 0
    )
  end)
  return vim.g.todos_statusline or "todos"
end

function M.extract_source(root)
  run_todos({ "extract", root or vim.fn.getcwd(), "--dry-run", "--index" }, function(payload)
    vim.notify(string.format("todos found %s source comment(s)", #(payload.comments or {})))
  end)
end

return M

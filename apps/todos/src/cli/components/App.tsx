import { useState, useCallback, useEffect } from "react";
import { render, Box, useInput, useApp } from "ink";
import { Header } from "./Header.js";
import { TaskList } from "./TaskList.js";
import { TaskDetail } from "./TaskDetail.js";
import { TaskForm } from "./TaskForm.js";
import { ProjectList } from "./ProjectList.js";
import { SearchView } from "./SearchView.js";
import {
  listTasks,
  getTaskWithRelations,
  createTask,
  updateTask,
  completeTask,
  startTask,
  deleteTask,
} from "../../db/tasks.js";
import { listProjects, getProject } from "../../db/projects.js";
import { searchTasks } from "../../lib/search.js";
import type { Task, TaskWithRelations as TaskWithRels, Project } from "../../types/index.js";

type View = "list" | "detail" | "add" | "edit" | "projects" | "search";

interface AppProps {
  projectId?: string;
}

function App({ projectId }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("list");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedTask, setSelectedTask] = useState<TaskWithRels | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectIndex, setProjectIndex] = useState(0);
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(projectId);
  const [searchResults, setSearchResults] = useState<Task[]>([]);

  const projectName = currentProjectId
    ? (getProject(currentProjectId)?.name ?? undefined)
    : undefined;

  const refreshTasks = useCallback(() => {
    const filter: Record<string, unknown> = {
      status: ["pending", "in_progress"],
    };
    if (currentProjectId) filter["project_id"] = currentProjectId;
    setTasks(listTasks(filter as any));
  }, [currentProjectId]);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  useInput((input, key) => {
    // Global: quit
    if (input === "q" && view === "list") {
      exit();
      return;
    }

    if (view === "list") {
      if (key.upArrow || input === "k") {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow || input === "j") {
        setSelectedIndex((i) => Math.min(tasks.length - 1, i + 1));
      } else if (key.return) {
        const task = tasks[selectedIndex];
        if (task) {
          const full = getTaskWithRelations(task.id);
          if (full) {
            setSelectedTask(full);
            setView("detail");
          }
        }
      } else if (input === "a") {
        setView("add");
      } else if (input === "d") {
        const task = tasks[selectedIndex];
        if (task) {
          completeTask(task.id);
          refreshTasks();
        }
      } else if (input === "s") {
        const task = tasks[selectedIndex];
        if (task) {
          try {
            startTask(task.id, "tui");
            refreshTasks();
          } catch {
            // Already locked
          }
        }
      } else if (input === "x") {
        const task = tasks[selectedIndex];
        if (task) {
          deleteTask(task.id);
          refreshTasks();
          setSelectedIndex((i) => Math.min(i, tasks.length - 2));
        }
      } else if (input === "/") {
        setView("search");
      } else if (input === "p") {
        setProjects(listProjects());
        setProjectIndex(0);
        setView("projects");
      } else if (input === "r") {
        refreshTasks();
      }
    } else if (view === "detail") {
      if (key.escape) {
        setView("list");
        refreshTasks();
      } else if (input === "d" && selectedTask) {
        completeTask(selectedTask.id);
        const updated = getTaskWithRelations(selectedTask.id);
        if (updated) setSelectedTask(updated);
        refreshTasks();
      } else if (input === "s" && selectedTask) {
        try {
          startTask(selectedTask.id, "tui");
          const updated = getTaskWithRelations(selectedTask.id);
          if (updated) setSelectedTask(updated);
          refreshTasks();
        } catch {
          // Already locked
        }
      } else if (input === "e" && selectedTask) {
        setView("edit");
      }
    } else if (view === "projects") {
      if (key.escape) {
        setView("list");
      } else if (key.upArrow || input === "k") {
        setProjectIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow || input === "j") {
        setProjectIndex((i) => Math.min(projects.length - 1, i + 1));
      } else if (key.return) {
        const project = projects[projectIndex];
        if (project) {
          setCurrentProjectId(project.id);
          setView("list");
          setSelectedIndex(0);
        }
      }
    }
  });

  const handleAddSubmit = useCallback(
    (data: { title: string; description?: string; priority?: string }) => {
      createTask({
        title: data.title,
        description: data.description,
        priority: (data.priority as Task["priority"]) || "medium",
        project_id: currentProjectId,
        working_dir: process.cwd(),
      });
      refreshTasks();
      setView("list");
    },
    [currentProjectId, refreshTasks],
  );

  const handleEditSubmit = useCallback(
    (data: { title: string; description?: string; priority?: string }) => {
      if (!selectedTask) return;
      updateTask(selectedTask.id, {
        version: selectedTask.version,
        title: data.title,
        description: data.description,
        priority: data.priority as Task["priority"],
      });
      const updated = getTaskWithRelations(selectedTask.id);
      if (updated) setSelectedTask(updated);
      refreshTasks();
      setView("detail");
    },
    [selectedTask, refreshTasks],
  );

  const handleCancel = useCallback(() => {
    setView(selectedTask && view === "edit" ? "detail" : "list");
  }, [selectedTask, view]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchResults(searchTasks(query, currentProjectId));
    },
    [currentProjectId],
  );

  const handleSearchSelect = useCallback((task: Task) => {
    const full = getTaskWithRelations(task.id);
    if (full) {
      setSelectedTask(full);
      setView("detail");
    }
  }, []);

  const viewLabel =
    view === "list"
      ? "Tasks"
      : view === "detail"
        ? "Detail"
        : view === "add"
          ? "Add Task"
          : view === "edit"
            ? "Edit Task"
            : view === "projects"
              ? "Projects"
              : "Search";

  return (
    <Box flexDirection="column">
      <Header
        projectName={projectName}
        taskCount={tasks.length}
        view={viewLabel}
      />

      {view === "list" && (
        <TaskList tasks={tasks} selectedIndex={selectedIndex} />
      )}

      {view === "detail" && selectedTask && (
        <TaskDetail task={selectedTask} />
      )}

      {view === "add" && (
        <TaskForm
          mode="add"
          onSubmit={handleAddSubmit}
          onCancel={handleCancel}
        />
      )}

      {view === "edit" && selectedTask && (
        <TaskForm
          mode="edit"
          initialTitle={selectedTask.title}
          initialDescription={selectedTask.description || ""}
          initialPriority={selectedTask.priority}
          onSubmit={handleEditSubmit}
          onCancel={handleCancel}
        />
      )}

      {view === "projects" && (
        <ProjectList
          projects={projects}
          selectedIndex={projectIndex}
        />
      )}

      {view === "search" && (
        <SearchView
          results={searchResults}
          onSearch={handleSearch}
          onSelect={handleSearchSelect}
          onBack={() => {
            setView("list");
            setSearchResults([]);
          }}
        />
      )}
    </Box>
  );
}

export function renderApp(projectId?: string): void {
  render(<App projectId={projectId} />);
}

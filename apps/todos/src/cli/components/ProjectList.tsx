import { Box, Text } from "ink";
import type { Project } from "../../types/index.js";

interface ProjectListProps {
  projects: Project[];
  selectedIndex: number;
}

export function ProjectList({ projects, selectedIndex }: ProjectListProps) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box marginBottom={1}>
        <Text dimColor>[esc] back  [enter] select project  [↑↓] navigate</Text>
      </Box>

      {projects.length === 0 ? (
        <Text dimColor>No projects registered. Use "todos projects --add &lt;path&gt;" to register.</Text>
      ) : (
        projects.map((project, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Box key={project.id}>
              <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text dimColor>{project.id.slice(0, 8)} </Text>
              <Text bold={isSelected}>{project.name}</Text>
              <Text dimColor> {project.path}</Text>
              {project.description && <Text dimColor> - {project.description}</Text>}
            </Box>
          );
        })
      )}
    </Box>
  );
}

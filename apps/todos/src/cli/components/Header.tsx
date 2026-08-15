import { Box, Text } from "ink";

interface HeaderProps {
  projectName?: string;
  taskCount: number;
  view: string;
}

export function Header({ projectName, taskCount, view }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          {" "}todos{" "}
        </Text>
        <Text dimColor> | </Text>
        <Text color="white">{view}</Text>
        {projectName && (
          <>
            <Text dimColor> | </Text>
            <Text color="yellow">{projectName}</Text>
          </>
        )}
        <Text dimColor> | </Text>
        <Text>{taskCount} task(s)</Text>
      </Box>
      <Box>
        <Text dimColor>
          [↑↓] navigate [enter] select [a] add [d] done [s] start [q] quit [/] search [p] projects [?] help
        </Text>
      </Box>
    </Box>
  );
}

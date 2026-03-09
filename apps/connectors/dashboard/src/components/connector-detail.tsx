import * as React from "react";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CheckCircleIcon,
  XCircleIcon,
  CopyIcon,
  CheckIcon,
  FolderIcon,
  CodeIcon,
  UserIcon,
  Trash2Icon,
  Loader2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuthStatus } from "@/types";

interface ConnectorDetail {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  auth: AuthStatus | null;
  overview: string | null;
}

interface ConnectorDetailDialogProps {
  connector: ConnectorDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0"
      onClick={handleCopy}
    >
      {copied ? (
        <CheckIcon className="size-3 text-green-500" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </Button>
  );
}

function AuthTypeBadge({ type }: { type: string }) {
  switch (type) {
    case "oauth":
      return (
        <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0">
          OAuth
        </Badge>
      );
    case "bearer":
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">
          Bearer
        </Badge>
      );
    default:
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0">
          API Key
        </Badge>
      );
  }
}

interface ProfilesData {
  current: string;
  profiles: string[];
}

function ProfilesSection({ connectorName }: { connectorName: string }) {
  const [data, setData] = React.useState<ProfilesData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [switching, setSwitching] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const fetchProfiles = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/connectors/${connectorName}/profiles`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch profiles");
        return res.json();
      })
      .then((d: ProfilesData) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [connectorName]);

  React.useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  function handleSwitch(profile: string) {
    setSwitching(profile);
    setError(null);
    fetch(`/api/connectors/${connectorName}/profiles/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to switch profile");
        return res.json();
      })
      .then(() => {
        setData((prev) => (prev ? { ...prev, current: profile } : prev));
        setSwitching(null);
      })
      .catch((e) => {
        setError(e.message);
        setSwitching(null);
      });
  }

  function handleDelete(profile: string) {
    setDeleting(profile);
    setError(null);
    fetch(`/api/connectors/${connectorName}/profiles/${profile}`, {
      method: "DELETE",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to delete profile");
        return res.json();
      })
      .then(() => {
        setDeleting(null);
        fetchProfiles();
      })
      .catch((e) => {
        setError(e.message);
        setDeleting(null);
      });
  }

  if (loading) {
    return (
      <div className="space-y-1.5">
        <h4 className="text-sm font-medium flex items-center gap-1.5">
          <UserIcon className="size-3.5" />
          Profiles
        </h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2Icon className="size-3 animate-spin" />
          Loading profiles...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-1.5">
        <h4 className="text-sm font-medium flex items-center gap-1.5">
          <UserIcon className="size-3.5" />
          Profiles
        </h4>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-medium flex items-center gap-1.5">
        <UserIcon className="size-3.5" />
        Profiles
        <span className="text-xs font-normal text-muted-foreground">
          (active: {data.current})
        </span>
      </h4>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="rounded-md border divide-y">
        {data.profiles.map((profile) => {
          const isCurrent = profile === data.current;
          const isSwitching = switching === profile;
          const isDeleting = deleting === profile;

          return (
            <div
              key={profile}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-2 rounded-full ${
                    isCurrent
                      ? "bg-green-500"
                      : "bg-muted-foreground/30"
                  }`}
                />
                <span className="text-sm">{profile}</span>
                {isCurrent && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                  >
                    active
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isSwitching || isDeleting}
                    onClick={() => handleSwitch(profile)}
                  >
                    {isSwitching ? (
                      <Loader2Icon className="size-3 animate-spin mr-1" />
                    ) : null}
                    Switch
                  </Button>
                )}
                {profile !== "default" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    disabled={isDeleting || isSwitching}
                    onClick={() => handleDelete(profile)}
                  >
                    {isDeleting ? (
                      <Loader2Icon className="size-3 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-3" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ConnectorDetailDialog({
  connector,
  open,
  onOpenChange,
  loading,
}: ConnectorDetailDialogProps) {
  if (!connector && !loading) return null;

  const importSnippet = connector
    ? `import { ${connector.name} } from './.connectors'`
    : "";
  const storagePath = connector
    ? `~/.connectors/connect-${connector.name}/`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {loading || !connector ? (
          <>
            <DialogHeader>
              <DialogTitle>Loading...</DialogTitle>
              <DialogDescription>Fetching connector details</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              Loading connector details...
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {connector.displayName}
                {connector.version && (
                  <span className="text-sm font-normal text-muted-foreground">
                    v{connector.version}
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>{connector.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{connector.category}</Badge>
                {connector.auth && (
                  <AuthTypeBadge type={connector.auth.type} />
                )}
                {connector.auth?.configured ? (
                  <Badge
                    variant="outline"
                    className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                  >
                    <CheckCircle2Icon className="size-3 mr-1" />
                    Configured
                  </Badge>
                ) : connector.auth ? (
                  <Badge
                    variant="outline"
                    className="border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400"
                  >
                    <CircleDashedIcon className="size-3 mr-1" />
                    Needs auth
                  </Badge>
                ) : null}
              </div>

              {/* Overview */}
              {connector.overview && (
                <div className="space-y-1.5">
                  <h4 className="text-sm font-medium">Overview</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {connector.overview}
                  </p>
                </div>
              )}

              {/* Environment Variables */}
              {connector.auth?.envVars && connector.auth.envVars.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-sm font-medium">Environment Variables</h4>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 text-xs">Variable</TableHead>
                          <TableHead className="h-8 text-xs">Description</TableHead>
                          <TableHead className="h-8 text-xs w-16">Set</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {connector.auth.envVars.map((v) => (
                          <TableRow key={v.variable}>
                            <TableCell className="py-1.5">
                              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                {v.variable}
                              </code>
                            </TableCell>
                            <TableCell className="py-1.5 text-xs text-muted-foreground">
                              {v.description}
                            </TableCell>
                            <TableCell className="py-1.5">
                              {v.set ? (
                                <CheckCircleIcon className="size-3.5 text-green-500" />
                              ) : (
                                <XCircleIcon className="size-3.5 text-muted-foreground" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Profiles */}
              <ProfilesSection connectorName={connector.name} />

              {/* Import snippet */}
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <CodeIcon className="size-3.5" />
                  Import
                </h4>
                <div className="flex items-center gap-1">
                  <code className="flex-1 rounded border bg-muted px-2 py-1.5 text-xs font-mono text-muted-foreground">
                    {importSnippet}
                  </code>
                  <CopyButton text={importSnippet} />
                </div>
              </div>

              {/* Storage path */}
              <div className="space-y-1.5">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <FolderIcon className="size-3.5" />
                  Storage Path
                </h4>
                <div className="flex items-center gap-1">
                  <code className="flex-1 rounded border bg-muted px-2 py-1.5 text-xs font-mono text-muted-foreground">
                    {storagePath}
                  </code>
                  <CopyButton text={storagePath} />
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import type {
  TaskInfo,
  ScriptInfo,
  NetworkInfo,
  ProcessStartedPayload,
  ProcessOutputPayload,
  ProcessExitPayload,
} from "../types";

export type RunnerStatus = "idle" | "running" | "finished" | "error";

export interface OutputLine {
  stream: "stdout" | "stderr" | "system";
  data: string;
  timestamp: number;
}

export function useRunner(socket: Socket | null) {
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>("idle");
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [processId, setProcessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch scripts, tasks, and networks from the server
  const fetchProjectData = useCallback(async () => {
    setLoading(true);
    try {
      const [scriptsRes, tasksRes, networksRes] = await Promise.all([
        fetch("/api/scripts").then((r) => r.json()),
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/networks").then((r) => r.json()),
      ]);
      setScripts(scriptsRes.scripts || []);
      setTasks(tasksRes.tasks || []);
      setNetworks(networksRes.networks || []);
    } catch (err) {
      console.error("[Runner] Failed to fetch project data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  // Listen for process events via socket
  useEffect(() => {
    if (!socket) return;

    const onStarted = (payload: ProcessStartedPayload) => {
      setRunnerStatus("running");
      setProcessId(payload.processId);
      setExitCode(null);
      setOutput([
        {
          stream: "system",
          data: `Running ${payload.type}: ${payload.name}${
            payload.network ? ` --network ${payload.network}` : ""
          }\n`,
          timestamp: Date.now(),
        },
      ]);
    };

    const onOutput = (payload: ProcessOutputPayload) => {
      setOutput((prev) => [
        ...prev,
        {
          stream: payload.stream,
          data: payload.data,
          timestamp: Date.now(),
        },
      ]);
    };

    const onExit = (payload: ProcessExitPayload) => {
      const status = payload.code === 0 ? "finished" : "error";
      setRunnerStatus(status);
      setExitCode(payload.code);
      setOutput((prev) => [
        ...prev,
        {
          stream: "system",
          data: `\nProcess exited with code ${payload.code}${
            payload.signal ? ` (${payload.signal})` : ""
          }\n`,
          timestamp: Date.now(),
        },
      ]);
    };

    socket.on("process:started" as any, onStarted);
    socket.on("process:output" as any, onOutput);
    socket.on("process:exit" as any, onExit);

    return () => {
      socket.off("process:started" as any, onStarted);
      socket.off("process:output" as any, onOutput);
      socket.off("process:exit" as any, onExit);
    };
  }, [socket]);

  // Execute a script or task
  const execute = useCallback(
    async (
      type: "script" | "task",
      name: string,
      network?: string,
      params?: Record<string, string>,
      envVars?: Record<string, string>
    ) => {
      setRunnerStatus("running");
      setExitCode(null);
      setOutput([
        {
          stream: "system",
          data: `Starting ${type}: ${name}${
            network ? ` --network ${network}` : ""
          }...\n`,
          timestamp: Date.now(),
        },
      ]);

      try {
        const res = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, name, network, params, envVars }),
        });

        const data = await res.json();

        if (!res.ok) {
          setRunnerStatus("error");
          setOutput((prev) => [
            ...prev,
            {
              stream: "stderr",
              data: `Error: ${data.error}\n`,
              timestamp: Date.now(),
            },
          ]);
          return;
        }

        setProcessId(data.processId);
      } catch (err: any) {
        setRunnerStatus("error");
        setOutput((prev) => [
          ...prev,
          {
            stream: "stderr",
            data: `Failed to start process: ${err.message}\n`,
            timestamp: Date.now(),
          },
        ]);
      }
    },
    []
  );

  // Kill running process
  const kill = useCallback(async () => {
    try {
      await fetch("/api/execute/kill", { method: "POST" });
      setOutput((prev) => [
        ...prev,
        {
          stream: "system",
          data: "\nProcess killed by user.\n",
          timestamp: Date.now(),
        },
      ]);
      setRunnerStatus("error");
    } catch (err: any) {
      console.error("[Runner] Failed to kill process:", err);
    }
  }, []);

  // Reset output for a new run
  const clearOutput = useCallback(() => {
    setOutput([]);
    setRunnerStatus("idle");
    setExitCode(null);
    setProcessId(null);
  }, []);

  return {
    scripts,
    tasks,
    networks,
    loading,
    runnerStatus,
    output,
    exitCode,
    processId,
    execute,
    kill,
    clearOutput,
    refresh: fetchProjectData,
  };
}

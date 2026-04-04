import React, { useState, useRef, useEffect } from "react";
import type { Socket } from "socket.io-client";
import { useRunner, OutputLine, RunnerStatus } from "../hooks/useRunner";
import type { TaskInfo, ScriptInfo } from "../types";

interface RunnerProps {
  socket: Socket | null;
}

type SelectedItem =
  | { type: "script"; item: ScriptInfo }
  | { type: "task"; item: TaskInfo }
  | null;

export function Runner({ socket }: RunnerProps) {
  const {
    scripts,
    tasks,
    networks,
    loading,
    runnerStatus,
    output,
    exitCode,
    execute,
    kill,
    clearOutput,
    refresh,
  } = useRunner(socket);

  const [selected, setSelected] = useState<SelectedItem>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [envInput, setEnvInput] = useState<string>("");
  const [listFilter, setListFilter] = useState<"all" | "scripts" | "tasks">("all");

  // Auto-select first remoteSigner network
  useEffect(() => {
    if (!selectedNetwork && networks.length > 0) {
      const remote = networks.find((n) => n.remoteSigner);
      setSelectedNetwork(remote?.name || networks[0].name);
    }
  }, [networks, selectedNetwork]);

  const handleSelect = (item: SelectedItem) => {
    setSelected(item);
    setParamValues({});
    setEnvInput("");
  };

  const handleRun = () => {
    if (!selected) return;

    let params: Record<string, string> | undefined;
    let envVars: Record<string, string> | undefined;

    if (selected.type === "task") {
      params = { ...paramValues };
      for (const key of Object.keys(params)) {
        if (!params[key]) delete params[key];
      }
    }

    if (envInput.trim()) {
      envVars = {};
      for (const line of envInput.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          envVars[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }
    }

    execute(
      selected.type,
      selected.item.name,
      selectedNetwork || undefined,
      params,
      envVars
    );
  };

  const isRunning = runnerStatus === "running";

  // Filter items
  const filteredScripts = listFilter === "tasks" ? [] : scripts;
  const filteredTasks = listFilter === "scripts" ? [] : tasks;
  const allItems = [
    ...filteredScripts.map((s) => ({ type: "script" as const, item: s })),
    ...filteredTasks.map((t) => ({ type: "task" as const, item: t })),
  ];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* ─── LEFT: Item List ───────────────────────────── */}
      <div className="w-64 flex-shrink-0 flex flex-col border-r border-white/[0.06]">
        {/* Filter control */}
        <div className="p-3 pb-2">
          <div className="segment-control flex">
            {(["all", "scripts", "tasks"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setListFilter(f)}
                className={`flex-1 text-[11px] font-medium py-1.5 px-2 rounded-lg transition-all ${
                  listFilter === f
                    ? "segment-active text-white"
                    : "text-gray-500 hover:text-gray-400"
                }`}
              >
                {f === "all" ? "All" : f === "scripts" ? "Scripts" : "Tasks"}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {allItems.length === 0 && (
            <div className="text-center py-10 px-4">
              <p className="text-gray-600 text-xs">No items found</p>
              <button
                onClick={refresh}
                className="mt-2 text-blue-400 hover:text-blue-300 text-xs transition-colors"
              >
                Refresh
              </button>
            </div>
          )}

          {allItems.map((entry) => {
            const isSelected =
              selected?.type === entry.type &&
              selected.item.name === entry.item.name;

            return (
              <button
                key={`${entry.type}-${entry.item.name}`}
                onClick={() => handleSelect(entry)}
                className={`w-full text-left px-3 py-2.5 rounded-xl mb-0.5 transition-all ${
                  isSelected
                    ? "bg-blue-500/15 text-white"
                    : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-300"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`text-xs ${
                    isSelected ? "opacity-100" : "opacity-50"
                  }`}>
                    {entry.type === "script" ? "\u{1F4C4}" : "\u{1F527}"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium truncate ${
                      isSelected ? "text-white" : ""
                    }`}>
                      {entry.item.name}
                    </p>
                    {entry.type === "task" && (entry.item as TaskInfo).description && (
                      <p className="text-[11px] text-gray-600 truncate mt-0.5">
                        {(entry.item as TaskInfo).description}
                      </p>
                    )}
                  </div>
                  {entry.type === "task" && (entry.item as TaskInfo).params.length > 0 && (
                    <span className="text-[10px] text-gray-600 bg-white/[0.04] px-1.5 py-0.5 rounded-md">
                      {(entry.item as TaskInfo).params.length}p
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── MIDDLE: Detail / Config ──────────────────── */}
      <div className="flex-1 flex flex-col border-r border-white/[0.06] min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center px-8">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl opacity-30">{"\u{1F4CB}"}</span>
              </div>
              <p className="text-gray-500 text-sm mb-1">Select a script or task</p>
              <p className="text-gray-700 text-xs">
                Choose from the list to configure and run
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Selected item header */}
            <div className="p-5 pb-4 border-b border-white/[0.04]">
              <div className="flex items-center gap-3 mb-1">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                  selected.type === "script" ? "bg-green-500/10" : "bg-purple-500/10"
                }`}>
                  {selected.type === "script" ? "\u{1F4C4}" : "\u{1F527}"}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-white text-base font-semibold truncate">
                    {selected.item.name}
                  </h2>
                  {selected.type === "task" && (selected.item as TaskInfo).description && (
                    <p className="text-gray-500 text-xs mt-0.5">
                      {(selected.item as TaskInfo).description}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${
                  selected.type === "script"
                    ? "bg-green-500/10 text-green-400"
                    : "bg-purple-500/10 text-purple-400"
                }`}>
                  {selected.type}
                </span>
              </div>
            </div>

            {/* Config form */}
            <div className="flex-1 p-5 space-y-5">
              {/* Network */}
              <div>
                <label className="block text-gray-400 text-[11px] font-medium uppercase tracking-wider mb-2">
                  Network
                </label>
                <select
                  value={selectedNetwork}
                  onChange={(e) => setSelectedNetwork(e.target.value)}
                  className="w-full glass-subtle rounded-xl px-3.5 py-2.5 text-sm text-white
                    focus:outline-none focus:ring-1 focus:ring-blue-500/40
                    appearance-none cursor-pointer"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23636366' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                >
                  <option value="">None (default)</option>
                  {networks.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                      {n.remoteSigner ? " \u2022 AirSign" : ""}
                      {n.chainId ? ` (${n.chainId})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Task params */}
              {selected.type === "task" && (selected.item as TaskInfo).params.length > 0 && (
                <div>
                  <label className="block text-gray-400 text-[11px] font-medium uppercase tracking-wider mb-2">
                    Parameters
                  </label>
                  <div className="space-y-3">
                    {(selected.item as TaskInfo).params.map((p) => (
                      <div key={p.name}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-gray-300 text-xs font-mono">
                            --{p.name}
                          </span>
                          {!p.isOptional && (
                            <span className="text-[9px] font-semibold text-orange-400 bg-orange-400/10 px-1.5 py-0.5 rounded">
                              REQUIRED
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-gray-600 text-[11px] mb-1.5">{p.description}</p>
                        )}
                        {p.isFlag ? (
                          <label className="flex items-center gap-2.5 cursor-pointer group">
                            <div className={`w-10 h-6 rounded-full relative transition-colors ${
                              paramValues[p.name] === "true"
                                ? "bg-blue-500"
                                : "bg-gray-700"
                            }`}>
                              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                                paramValues[p.name] === "true" ? "left-5" : "left-1"
                              }`} />
                            </div>
                            <span className="text-gray-400 text-xs group-hover:text-gray-300 transition-colors">
                              {paramValues[p.name] === "true" ? "Enabled" : "Disabled"}
                            </span>
                          </label>
                        ) : (
                          <input
                            type="text"
                            placeholder={p.defaultValue || `Enter ${p.name}...`}
                            value={paramValues[p.name] || ""}
                            onChange={(e) =>
                              setParamValues({ ...paramValues, [p.name]: e.target.value })
                            }
                            className="w-full glass-subtle rounded-xl px-3.5 py-2.5 text-sm text-white font-mono
                              placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Env vars for scripts */}
              {selected.type === "script" && (
                <div>
                  <label className="block text-gray-400 text-[11px] font-medium uppercase tracking-wider mb-2">
                    Environment Variables
                  </label>
                  <textarea
                    value={envInput}
                    onChange={(e) => setEnvInput(e.target.value)}
                    placeholder={"KEY=value\nGREETER_ADDRESS=0x..."}
                    rows={3}
                    className="w-full glass-subtle rounded-xl px-3.5 py-2.5 text-sm text-white font-mono
                      placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40 resize-none"
                  />
                  <p className="text-gray-700 text-[10px] mt-1.5">One KEY=VALUE per line</p>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="p-4 border-t border-white/[0.04]">
              <div className="flex gap-2.5">
                {isRunning ? (
                  <button
                    onClick={kill}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all
                      bg-red-500/15 hover:bg-red-500/25 text-red-400 hover:text-red-300"
                  >
                    Stop Process
                  </button>
                ) : (
                  <button
                    onClick={handleRun}
                    disabled={!selected}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all
                      bg-green-500 hover:bg-green-400 text-white
                      disabled:opacity-40 disabled:cursor-not-allowed
                      shadow-lg shadow-green-500/20"
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Run
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── RIGHT: Output Console ────────────────────── */}
      <div className="w-80 flex-shrink-0 flex flex-col min-h-0">
        {/* Console header */}
        <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              runnerStatus === "running"
                ? "bg-orange-400 animate-pulse"
                : runnerStatus === "finished"
                ? "bg-green-400"
                : runnerStatus === "error"
                ? "bg-red-400"
                : "bg-gray-700"
            }`} />
            <span className="text-[11px] font-medium text-gray-400">Console</span>
            {exitCode !== null && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                exitCode === 0
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}>
                {exitCode === 0 ? "success" : `exit ${exitCode}`}
              </span>
            )}
          </div>
          {output.length > 0 && runnerStatus !== "running" && (
            <button
              onClick={clearOutput}
              className="text-gray-600 hover:text-gray-400 text-[11px] transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Console content */}
        <ConsoleOutput output={output} status={runnerStatus} />
      </div>
    </div>
  );
}

// ─── Console Output ──────────────────────────────────────────────

function ConsoleOutput({
  output,
  status,
}: {
  output: OutputLine[];
  status: RunnerStatus;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  if (output.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8">
          <div className="w-10 h-10 rounded-xl bg-white/[0.02] flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-700">
              <path d="M4 17l6-6-6-6M12 19h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-gray-600 text-xs">Output will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap"
    >
      {output.map((line, i) => (
        <span
          key={i}
          className={
            line.stream === "stderr"
              ? "text-red-400/80"
              : line.stream === "system"
              ? "text-blue-400/70"
              : "text-gray-400"
          }
        >
          {line.data}
        </span>
      ))}
      {status === "running" && (
        <span className="inline-block w-1.5 h-3.5 bg-gray-500 animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
      )}
    </div>
  );
}

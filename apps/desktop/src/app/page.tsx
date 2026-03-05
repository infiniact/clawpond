"use client";

import { Sidebar } from "../components/sidebar";
import { ChatArea } from "../components/chat-area";
import { TaskPanel } from "../components/task-panel";
import { TopBar } from "../components/top-bar";

export default function Home() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-deep font-sans">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <ChatArea />
        <TaskPanel />
      </div>
    </div>
  );
}

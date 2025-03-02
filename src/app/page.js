// File: app/page.js
"use client";

import ToolHireChatbot from "./components/ToolHireChatbot";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 ">
      <div className="container mx-auto px-4 py-8 ">
        <h1 className="text-2xl font-bold text-center mb-2">
          Tool Hire Recommendation
        </h1>
        <p className="text-center mb-6">
          Get expert recommendations on which tools you need for your DIY
          project and how long you should hire them for.
        </p>
        <div className="max-w-5xl mx-auto bg-white rounded-lg shadow-lg overflow-hidden border border-gray-200">
          <ToolHireChatbot />
        </div>
      </div>
    </main>
  );
}

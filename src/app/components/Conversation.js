// app/components/Conversation.js
import Message from "./Chat";

export default function Conversation({ messages, loading }) {
  return (
    <div className="border rounded-md p-4 h-[500px] overflow-y-auto flex flex-col gap-4">
      {messages.map((message, index) => (
        <Message key={index} message={message} />
      ))}
      {loading && (
        <div className="self-start bg-gray-200 text-gray-700 p-3 rounded-lg">
          <div className="flex space-x-2">
            <div
              className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"
              style={{ animationDelay: "0ms" }}
            ></div>
            <div
              className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"
              style={{ animationDelay: "150ms" }}
            ></div>
            <div
              className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"
              style={{ animationDelay: "300ms" }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}

// app/components/
export default function Message({ message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] p-3 rounded-lg ${
          isUser
            ? "bg-blue-600 text-white rounded-br-none"
            : "bg-gray-200 text-gray-700 rounded-bl-none"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

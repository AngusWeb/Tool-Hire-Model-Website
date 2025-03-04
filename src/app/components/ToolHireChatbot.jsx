// File: app/components/ToolHireChatbot.jsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";

export default function ToolHireChatbot() {
  const [messages, setMessages] = useState([
    {
      role: "system",
      content:
        "Welcome to DIY Project Tool Advisor! Let's find the right tools for your project. Please answer some questions about your project so we can recommend the best tools. The more information you can provide the better recommendations it can make.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState("gathering"); // 'gathering' or 'recommendation'
  const [conversationHistory, setConversationHistory] = useState([]); // Changed from conversationContext to conversationHistory array
  const [projectInformation, setProjectInformation] = useState("");
  const streamingEnabled = true; // Always use streaming responses
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState(""); // State to hold current streaming message
  const messagesEndRef = useRef(null);
  const [initialMessageSent, setInitialMessageSent] = useState(false);

  // Use useCallback to memoize the handleSendMessage function
  const handleSendMessage = useCallback(
    async (userMessage) => {
      const messageToSend = userMessage || input;

      if (!messageToSend || !messageToSend.trim()) {
        return;
      }

      // Add user message to chat
      setMessages((prev) => [
        ...prev,
        { role: "user", content: messageToSend },
      ]);
      setIsLoading(true);
      setInput("");

      // Add an empty assistant message for streaming if streaming is enabled
      if (streamingEnabled) {
        setCurrentStreamingMessage("");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", streaming: true },
        ]);
      }

      try {
        if (streamingEnabled) {
          // Streaming implementation
          const response = await fetch("/api/tool-recommendation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              phase,
              userInput: messageToSend,
              conversationHistory,
              projectInformation,
              streaming: true, // Request streaming response
            }),
          });

          if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";
          let completeData = null;

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            // Process the chunks - each chunk is a JSON string followed by newline
            const chunkText = decoder.decode(value);
            const chunks = chunkText.split("\n").filter(Boolean);

            for (const chunk of chunks) {
              try {
                const data = JSON.parse(chunk);

                if (data.error) {
                  // Handle error
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    // Replace the streaming message with error message
                    if (newMessages[newMessages.length - 1].streaming) {
                      newMessages.pop(); // Remove streaming placeholder
                    }
                    return [
                      ...newMessages,
                      { role: "system", content: data.text, error: true },
                    ];
                  });
                  break;
                }

                if (!data.done) {
                  // Update the streaming message
                  fullContent += data.chunk;
                  setCurrentStreamingMessage(fullContent);

                  // Update the last message in the messages array
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    if (newMessages[newMessages.length - 1].streaming) {
                      newMessages[newMessages.length - 1].content = fullContent;
                    }
                    return newMessages;
                  });
                } else {
                  // Stream complete, store the final data
                  completeData = data;
                }
              } catch (error) {
                console.error("Error parsing chunk:", error, chunk);
              }
            }
          }

          // Stream is complete, update with final data
          if (completeData) {
            // Remove the streaming flag
            setMessages((prev) => {
              const newMessages = [...prev];
              if (newMessages[newMessages.length - 1].streaming) {
                newMessages[newMessages.length - 1].streaming = false;
              }
              return newMessages;
            });

            // Update conversation history
            if (completeData.conversationHistory) {
              setConversationHistory(completeData.conversationHistory);
            }

            // Check if information gathering phase is complete
            if (completeData.isComplete && phase === "gathering") {
              setProjectInformation(completeData.projectInformation);

              // Add transition message
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content:
                    "Information gathering complete. Analysing your project needs...",
                },
              ]);

              // Switch to recommendation phase
              setPhase("recommendation");

              // Automatically trigger the recommendation phase
              setTimeout(() => {
                handleRecommendationPhase(completeData.projectInformation);
              }, 1000);
            }
          }
        } else {
          // Non-streaming implementation (original code)
          const response = await fetch("/api/tool-recommendation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              phase,
              userInput: messageToSend,
              conversationHistory,
              projectInformation,
            }),
          });

          if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
          }

          const data = await response.json();

          if (data.error) {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: data.text, error: true },
            ]);
          } else {
            // Add AI response to chat
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: data.text },
            ]);

            // Update conversation history
            if (data.conversationHistory) {
              setConversationHistory(data.conversationHistory);
            }

            // Check if information gathering phase is complete
            if (data.isComplete && phase === "gathering") {
              setProjectInformation(data.projectInformation);

              // Add transition message
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content:
                    "Information gathering complete. Analysing your project needs...",
                },
              ]);

              // Switch to recommendation phase
              setPhase("recommendation");

              // Automatically trigger the recommendation phase
              setTimeout(() => {
                handleRecommendationPhase(data.projectInformation);
              }, 1000);
            }
          }
        }
      } catch (error) {
        console.error("Error sending message:", error);
        setMessages((prev) => {
          const newMessages = [...prev];
          // If there's a streaming message, remove it
          if (
            newMessages.length > 0 &&
            newMessages[newMessages.length - 1].streaming
          ) {
            newMessages.pop();
          }
          return [
            ...newMessages,
            {
              role: "system",
              content:
                "Sorry, there was an error processing your request: " +
                error.message,
              error: true,
            },
          ];
        });
      } finally {
        setIsLoading(false);
        setCurrentStreamingMessage("");
      }
    },
    [input, phase, conversationHistory, projectInformation, streamingEnabled]
  ); // Updated dependencies

  const handleRecommendationPhase = async (projectInfo) => {
    setIsLoading(true);

    // Add an empty assistant message for streaming if streaming is enabled
    if (streamingEnabled) {
      setCurrentStreamingMessage("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);
    }

    try {
      if (streamingEnabled) {
        // Streaming implementation for recommendation phase
        const response = await fetch("/api/tool-recommendation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phase: "recommendation",
            projectInformation: projectInfo,
            streaming: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let streamComplete = false;

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Process the chunks
          const chunkText = decoder.decode(value);
          const chunks = chunkText.split("\n").filter(Boolean);

          for (const chunk of chunks) {
            try {
              const data = JSON.parse(chunk);

              if (data.error) {
                // Handle error
                setMessages((prev) => {
                  const newMessages = [...prev];
                  // Replace the streaming message with error message
                  if (newMessages[newMessages.length - 1].streaming) {
                    newMessages.pop(); // Remove streaming placeholder
                  }
                  return [
                    ...newMessages,
                    { role: "system", content: data.text, error: true },
                  ];
                });
                break;
              }

              if (!data.done) {
                // Update the streaming message
                fullContent += data.chunk;
                setCurrentStreamingMessage(fullContent);

                // Update the last message in the messages array
                setMessages((prev) => {
                  const newMessages = [...prev];
                  if (newMessages[newMessages.length - 1].streaming) {
                    newMessages[newMessages.length - 1].content = fullContent;
                  }
                  return newMessages;
                });
              } else {
                // Stream complete
                streamComplete = true;
                if (data.text) {
                  fullContent = data.text; // Use the complete text if provided
                }
              }
            } catch (error) {
              console.error("Error parsing chunk:", error, chunk);
            }
          }
        }

        if (streamComplete) {
          // Remove the streaming flag
          setMessages((prev) => {
            const newMessages = [...prev];
            if (newMessages[newMessages.length - 1].streaming) {
              newMessages[newMessages.length - 1].streaming = false;
            }
            return newMessages;
          });

          // Add final message
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                "Thank you for using our DIY Project Tool Advisor! We hope this helps with your project.",
            },
          ]);
        }
      } else {
        // Non-streaming implementation (original code)
        const response = await fetch("/api/tool-recommendation", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phase: "recommendation",
            projectInformation: projectInfo,
          }),
        });

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const data = await response.json();

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.text },
        ]);

        // Add final message
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content:
              "Thank you for using our DIY Project Tool Advisor! We hope this helps with your project.",
          },
        ]);
      }
    } catch (error) {
      console.error("Error getting recommendations:", error);
      setMessages((prev) => {
        const newMessages = [...prev];
        // If there's a streaming message, remove it
        if (
          newMessages.length > 0 &&
          newMessages[newMessages.length - 1].streaming
        ) {
          newMessages.pop();
        }
        return [
          ...newMessages,
          {
            role: "system",
            content:
              "Sorry, there was an error generating recommendations: " +
              error.message,
            error: true,
          },
        ];
      });
    } finally {
      setIsLoading(false);
      setCurrentStreamingMessage("");
    }
  };

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStreamingMessage]);

  // Initial message from assistant when component mounts
  useEffect(() => {
    if (!initialMessageSent) {
      handleSendMessage("Hello! I'd like to discuss my project.");
      setInitialMessageSent(true);
    }
  }, [handleSendMessage, initialMessageSent]);

  // Streaming is always enabled, no toggle function needed

  // Custom components for ReactMarkdown
  const markdownComponents = {
    // Style headers
    h1: ({ node, ...props }) => (
      <h1 className="text-xl font-bold my-3" {...props} />
    ),
    h2: ({ node, ...props }) => (
      <h2 className="text-lg font-bold my-2" {...props} />
    ),
    h3: ({ node, ...props }) => (
      <h3 className="text-md font-bold my-2" {...props} />
    ),

    // Style paragraphs
    p: ({ node, ...props }) => <p className="my-2" {...props} />,

    // Style lists
    ul: ({ node, ...props }) => (
      <ul className="list-disc pl-6 my-2" {...props} />
    ),
    ol: ({ node, ...props }) => (
      <ol className="list-decimal pl-6 my-2" {...props} />
    ),
    li: ({ node, ...props }) => <li className="my-1" {...props} />,

    // Style blockquotes
    blockquote: ({ node, ...props }) => (
      <blockquote
        className="border-l-4 border-gray-300 pl-4 italic my-2"
        {...props}
      />
    ),

    // Style code blocks and inline code
    code: ({ node, inline, ...props }) =>
      inline ? (
        <code
          className="bg-gray-100 px-1 rounded font-mono text-sm"
          {...props}
        />
      ) : (
        <code
          className="block bg-gray-100 p-2 rounded font-mono text-sm my-2 overflow-x-auto"
          {...props}
        />
      ),

    // Style tables
    table: ({ node, ...props }) => (
      <table className="border-collapse my-4 w-full" {...props} />
    ),
    thead: ({ node, ...props }) => <thead className="bg-gray-100" {...props} />,
    tbody: ({ node, ...props }) => <tbody {...props} />,
    tr: ({ node, ...props }) => (
      <tr className="border-b border-gray-200" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th className="py-2 px-3 text-left font-semibold" {...props} />
    ),
    td: ({ node, ...props }) => <td className="py-2 px-3" {...props} />,
  };

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto">
      <div className="bg-[#e26e2a] text-white p-4 text-center">
        <h1 className="text-xl font-bold">DIY Project Tool Advisor</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-gray-100">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`mb-4 ${
              message.role === "user" ? "text-right" : "text-left"
            }`}
          >
            <div
              className={`inline-block rounded-lg p-3 ${
                message.role === "user"
                  ? "bg-black text-white max-w-3/4"
                  : message.role === "system"
                  ? "bg-gray-300 text-gray-800 mx-auto text-center w-full"
                  : "bg-white text-gray-800 border border-gray-300 max-w-3/4"
              } ${
                message.error ? "bg-red-100 border-red-300 text-red-800" : ""
              } ${message.streaming ? "border-green-400 border-2" : ""}`}
            >
              {message.role === "assistant" ? (
                <div className="markdown-content">
                  <ReactMarkdown components={markdownComponents}>
                    {message.content}
                  </ReactMarkdown>
                  {message.streaming && (
                    <span className="inline-block animate-pulse">▌</span>
                  )}
                </div>
              ) : (
                message.content.split("\n").map((line, i) => (
                  <p key={i} className={i > 0 ? "mt-2" : ""}>
                    {line}
                  </p>
                ))
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-300 bg-white">
        <div className="flex">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSendMessage(input)}
            placeholder="Type your message here..."
            disabled={isLoading || phase === "recommendation"}
            className="flex-1 p-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-black"
          />
          <button
            onClick={() => handleSendMessage(input)}
            disabled={isLoading || !input.trim() || phase === "recommendation"}
            className="bg-black hover:bg-black text-white p-2 rounded-r-lg disabled:bg-[#e26e2a]"
          >
            {isLoading ? "Loading..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

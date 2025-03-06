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
  const [partialResponse, setPartialResponse] = useState(null); // Store partial responses when timeout occurs
  const abortControllerRef = useRef(null); // To manage fetch request timeouts
  const timeoutDuration = 9500; // Just under Vercel's 10s limit

  // Use useCallback to memoize the handleSendMessage function
  const handleSendMessage = useCallback(
    async (userMessage) => {
      const messageToSend = userMessage || input;

      if (!messageToSend || !messageToSend.trim()) {
        return;
      }

      // If we have a partial response but the user is sending a new message,
      // ensure we handle the continuation first
      if (partialResponse && !userMessage) {
        handleContinueResponse();
        return;
      }

      // Add user message to chat only if it's not a continuation
      if (!partialResponse) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: messageToSend },
        ]);
      }

      setIsLoading(true);
      setInput("");

      // Add an empty assistant message for streaming if streaming is enabled
      if (streamingEnabled && !partialResponse) {
        setCurrentStreamingMessage("");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", streaming: true },
        ]);
      }

      try {
        if (streamingEnabled) {
          // Create abort controller for timeout handling
          const controller = new AbortController();
          abortControllerRef.current = controller;

          // Set timeout for the request
          const timeoutId = setTimeout(() => {
            // Store the partial response before aborting
            if (currentStreamingMessage) {
              setPartialResponse({
                text: currentStreamingMessage,
                phase: phase,
              });
            }
            controller.abort();
          }, timeoutDuration);

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
              streaming: true,
              partialResponse: partialResponse, // Include partial response if exists
            }),
            signal: controller.signal,
          });

          // Clear the timeout as request completed
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullContent = partialResponse ? partialResponse.text : "";
          let completeData = null;

          // If we're continuing from a partial response, start with that content
          if (partialResponse) {
            setCurrentStreamingMessage(fullContent);

            // Replace the last message if it's streaming or add a new one
            setMessages((prev) => {
              const newMessages = [...prev];
              if (
                newMessages.length > 0 &&
                newMessages[newMessages.length - 1].role === "assistant" &&
                newMessages[newMessages.length - 1].streaming
              ) {
                // Update existing streaming message
                newMessages[newMessages.length - 1].content = fullContent;
              } else {
                // Add new streaming message
                newMessages.push({
                  role: "assistant",
                  content: fullContent,
                  streaming: true,
                });
              }
              return newMessages;
            });
          }

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
            // Clear partial response state as we've successfully completed
            setPartialResponse(null);

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
              partialResponse: partialResponse, // Include partial response if exists
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
            // Clear partial response state
            setPartialResponse(null);

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

        // Check if this is an AbortError (timeout)
        if (error.name === "AbortError") {
          // Add message to show the user we're continuing due to timeout
          setMessages((prev) => {
            const newMessages = [...prev];
            // Don't remove streaming message as we'll continue from it
            return [
              ...newMessages,
              {
                role: "system",
                content:
                  "The response was cut off due to a timeout. Continuing...",
                timeout: true,
              },
            ];
          });

          // Auto-continue after a brief delay
          setTimeout(() => {
            handleContinueResponse();
          }, 1000);
        } else {
          // Handle other errors
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
        }
      } finally {
        setIsLoading(false);
        if (!partialResponse) {
          setCurrentStreamingMessage("");
        }
      }
    },
    [
      input,
      phase,
      conversationHistory,
      projectInformation,
      streamingEnabled,
      partialResponse,
      currentStreamingMessage,
    ]
  ); // Updated dependencies

  // Function to handle continuing a response after timeout
  const handleContinueResponse = useCallback(() => {
    if (!partialResponse) return;

    // Set loading state but keep the partial message visible
    setIsLoading(true);

    // Call appropriate handler based on phase
    if (partialResponse.phase === "gathering") {
      handleSendMessage(""); // Empty string tells the function we're continuing
    } else {
      handleRecommendationPhase(projectInformation, true); // true indicates continuation
    }
  }, [partialResponse, projectInformation, handleSendMessage]);

  const handleRecommendationPhase = async (
    projectInfo,
    isContinuation = false
  ) => {
    setIsLoading(true);

    // Add an empty assistant message for streaming if streaming is enabled
    // and this is not a continuation of a partial response
    if (streamingEnabled && !isContinuation && !partialResponse) {
      setCurrentStreamingMessage("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);
    }

    try {
      if (streamingEnabled) {
        // Create abort controller for timeout handling
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Set timeout for the request
        const timeoutId = setTimeout(() => {
          // Store the partial response before aborting
          if (currentStreamingMessage) {
            setPartialResponse({
              text: currentStreamingMessage,
              phase: "recommendation",
            });
          }
          controller.abort();
        }, timeoutDuration);

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
            partialResponse:
              partialResponse && partialResponse.phase === "recommendation"
                ? partialResponse
                : null,
          }),
          signal: controller.signal,
        });

        // Clear the timeout as request completed
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent =
          partialResponse && partialResponse.phase === "recommendation"
            ? partialResponse.text
            : "";
        let streamComplete = false;

        // If we're continuing from a partial response, start with that content
        if (partialResponse && partialResponse.phase === "recommendation") {
          setCurrentStreamingMessage(fullContent);

          // Update the last message if it's streaming or add a new one
          setMessages((prev) => {
            const newMessages = [...prev];
            if (
              newMessages.length > 0 &&
              newMessages[newMessages.length - 1].role === "assistant" &&
              newMessages[newMessages.length - 1].streaming
            ) {
              // Update existing streaming message
              newMessages[newMessages.length - 1].content = fullContent;
            } else {
              // Add new streaming message
              newMessages.push({
                role: "assistant",
                content: fullContent,
                streaming: true,
              });
            }
            return newMessages;
          });
        }

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
          // Clear partial response state as we've successfully completed
          setPartialResponse(null);

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
            partialResponse:
              partialResponse && partialResponse.phase === "recommendation"
                ? partialResponse
                : null,
          }),
        });

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const data = await response.json();

        // Clear partial response state
        setPartialResponse(null);

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

      // Check if this is an AbortError (timeout)
      if (error.name === "AbortError") {
        // Add message to show the user we're continuing due to timeout
        setMessages((prev) => {
          const newMessages = [...prev];
          // Don't remove streaming message as we'll continue from it
          return [
            ...newMessages,
            {
              role: "system",
              content:
                "The response was cut off due to a timeout. Continuing...",
              timeout: true,
            },
          ];
        });

        // Auto-continue after a brief delay
        setTimeout(() => {
          handleContinueResponse();
        }, 1000);
      } else {
        // Handle other errors
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
      }
    } finally {
      setIsLoading(false);
      if (!partialResponse) {
        setCurrentStreamingMessage("");
      }
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

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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
                  ? message.timeout
                    ? "bg-yellow-100 text-yellow-800 border-yellow-300 border mx-auto text-center w-full"
                    : "bg-gray-300 text-gray-800 mx-auto text-center w-full"
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
            placeholder={
              partialResponse
                ? "Continuing previous response..."
                : "Type your message here..."
            }
            disabled={
              isLoading ||
              phase === "recommendation" ||
              partialResponse !== null
            }
            className="flex-1 p-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-black"
          />
          <button
            onClick={() =>
              partialResponse
                ? handleContinueResponse()
                : handleSendMessage(input)
            }
            disabled={
              (isLoading || !input.trim() || phase === "recommendation") &&
              !partialResponse
            }
            className="bg-black hover:bg-black text-white p-2 rounded-r-lg disabled:bg-[#e26e2a]"
          >
            {isLoading ? "Loading..." : partialResponse ? "Continue" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

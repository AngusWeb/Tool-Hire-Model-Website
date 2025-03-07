import { promises as fs } from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// API key for Google's Gemini API
const API_KEY = process.env.API_KEY; // Replace with your actual API key or use environment variables

/**
 * Initialize the Google Generative AI client
 * @returns {Object} - The initialized Gemini model
 */
function initializeGeminiModel(modelName = "gemini-2.0-flash") {
  const genAI = new GoogleGenerativeAI(API_KEY);
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
    },
    // Set system instructions here instead of sending as a user message
    systemInstruction: {
      parts: [{ text: IMPROVED_PROMPT }],
    },
  });
}

/**
 * API route handler for Next.js - handles streaming responses
 * @param {Request} request - The incoming request
 * @returns {Response} - The API response (streaming or regular JSON)
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      phase,
      userInput,
      conversationHistory,
      projectInformation,
      streaming = false,
      continuationMode = false,
      partialResponse = "",
    } = body;

    // Check if streaming is requested
    if (streaming) {
      // Handle streaming responses
      if (phase === "gathering") {
        // Stream information gathering phase response
        return streamInformationGathering(
          userInput,
          conversationHistory,
          continuationMode,
          partialResponse
        );
      } else if (phase === "recommendation") {
        // Stream tool recommendation phase response
        return streamToolRecommendation(
          projectInformation,
          continuationMode,
          partialResponse
        );
      } else {
        return Response.json(
          {
            error: true,
            text: "Invalid phase specified for streaming. Must be 'gathering' or 'recommendation'.",
          },
          { status: 400 }
        );
      }
    } else {
      // Handle non-streaming responses (original behavior)
      if (phase === "gathering") {
        // Handle the information gathering phase
        const result = await handleInformationGathering(
          userInput,
          conversationHistory,
          continuationMode,
          partialResponse
        );
        return Response.json(result);
      } else if (phase === "recommendation") {
        // Handle the tool recommendation phase
        const result = await handleToolRecommendation(
          projectInformation,
          continuationMode,
          partialResponse
        );
        return Response.json(result);
      } else {
        return Response.json(
          {
            error: true,
            text: "Invalid phase specified. Must be 'gathering' or 'recommendation'.",
          },
          { status: 400 }
        );
      }
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return Response.json(
      {
        error: true,
        text:
          "An error occurred while processing your request: " + error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * Stream the information gathering phase response
 * @param {string} userInput - User's current input
 * @param {Array} conversationHistory - Previous conversation history, if any
 * @param {boolean} continuationMode - Whether this is continuing a cut-off response
 * @param {string} partialResponse - The partial response that was cut off
 * @returns {Response} - A streaming response
 */
async function streamInformationGathering(
  userInput,
  conversationHistory = [],
  continuationMode = false,
  partialResponse = ""
) {
  const encoder = new TextEncoder();
  const model = initializeGeminiModel();

  // Create a new ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Initialize chat
        let chat;

        if (continuationMode && partialResponse) {
          // For continuation mode, we'll include the partial response in the prompt
          const continuationPrompt = `The previous response was cut off. Here was the partial response: "${partialResponse}". Please continue from where you left off.`;

          // We use the history but we'll directly ask for continuation
          chat = model.startChat({
            history: formatChatHistory(conversationHistory),
          });

          // Send the continuation request
          const streamResult = await chat.sendMessageStream(continuationPrompt);

          // Keep track of the full response for final processing
          let continuationResponseText = "";

          // Stream each chunk as it arrives
          for await (const chunk of streamResult.stream) {
            const chunkText = chunk.text();
            continuationResponseText += chunkText;

            // Send this chunk to the client
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  chunk: chunkText,
                  done: false,
                  continuation: true,
                }) + "\n"
              )
            );
          }

          // Combine the partial and continuation response
          const fullResponseText = partialResponse + continuationResponseText;

          // Check if the combined response is complete
          const isComplete = fullResponseText.includes("## FINAL SUMMARY ##");
          let projectInformation = "";

          if (isComplete) {
            projectInformation = fullResponseText;
          }

          // Update conversation history with the complete response
          // Remove the last model response if it was partial
          if (
            conversationHistory.length > 0 &&
            conversationHistory[conversationHistory.length - 1].role === "model"
          ) {
            conversationHistory.pop();
          }

          conversationHistory.push({
            role: "model",
            parts: [{ text: fullResponseText }],
          });

          // Send the final status
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                done: true,
                conversationHistory: conversationHistory,
                isComplete: isComplete,
                projectInformation: projectInformation,
                continuation: true,
                fullResponse: fullResponseText,
              }) + "\n"
            )
          );
        } else {
          // If this is a new conversation, start with an empty history
          // System instructions are already included in the model configuration
          if (!conversationHistory || conversationHistory.length === 0) {
            chat = model.startChat();
            conversationHistory = []; // Start with empty conversation history
          } else {
            // For existing conversations, use the history
            chat = model.startChat({
              history: formatChatHistory(conversationHistory),
            });
          }

          // Send the user's message and get a streaming response
          const streamResult = await chat.sendMessageStream(userInput);

          // Keep track of the full response for final processing
          let fullResponseText = "";

          // Stream each chunk as it arrives
          for await (const chunk of streamResult.stream) {
            const chunkText = chunk.text();
            fullResponseText += chunkText;

            // Send this chunk to the client
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  chunk: chunkText,
                  done: false,
                }) + "\n"
              )
            );
          }

          // After streaming completes, determine if this phase is complete
          const isComplete = fullResponseText.includes("## FINAL SUMMARY ##");
          let projectInformation = "";

          if (isComplete) {
            projectInformation = fullResponseText;
          }

          // Add the current interaction to conversation history
          conversationHistory.push({
            role: "user",
            parts: [{ text: userInput }],
          });

          conversationHistory.push({
            role: "model",
            parts: [{ text: fullResponseText }],
          });

          // Send the final status
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                done: true,
                conversationHistory: conversationHistory,
                isComplete: isComplete,
                projectInformation: projectInformation,
              }) + "\n"
            )
          );
        }

        // Close the stream
        controller.close();
      } catch (error) {
        // Handle errors in the stream
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: true,
              text: "Error in streaming response: " + error.message,
              done: true,
            }) + "\n"
          )
        );
        controller.close();
      }
    },
  });

  // Return the stream as a response
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Stream the tool recommendation phase response
 * @param {string} projectInformation - The gathered project information
 * @param {boolean} continuationMode - Whether this is continuing a cut-off response
 * @param {string} partialResponse - The partial response that was cut off
 * @returns {Response} - A streaming response
 */
async function streamToolRecommendation(
  projectInformation,
  continuationMode = false,
  partialResponse = ""
) {
  const encoder = new TextEncoder();

  // Create a new ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Read the tool information from file
        let toolInformation;
        let productUrls;
        try {
          toolInformation = await readFromFile("tool_information.txt");
          productUrls = await readFromFile("product_urls.txt");
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                error: true,
                text: "Error: Unable to access tool information or product URLs. Please try again later.",
                done: true,
              }) + "\n"
            )
          );
          controller.close();
          return;
        }

        const model = initializeGeminiModel();
        let streamResult;

        if (continuationMode && partialResponse) {
          // For continuation mode, we'll ask the model to continue from where it left off
          const continuationPrompt = `The previous response was cut off. Here was the partial response: "${partialResponse}". Please continue from where you left off without repeating any content.`;

          // Send the continuation prompt to Gemini API and get a streaming result
          streamResult = await model.generateContentStream(continuationPrompt);
        } else {
          // Normal mode - generate the initial response
          const prompt = PROMPT_TEMPLATE.replace(
            "{project_information}",
            projectInformation
          )
            .replace("{tool_information}", toolInformation)
            .replace("{product_urls_file}", productUrls);

          // Send the prompt to Gemini API and get a streaming result
          streamResult = await model.generateContentStream(prompt);
        }

        // Keep track of the full response
        let responseText = continuationMode ? partialResponse : "";

        // Stream each chunk as it arrives
        for await (const chunk of streamResult.stream) {
          const chunkText = chunk.text();
          responseText += chunkText;

          // Send this chunk to the client
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                chunk: chunkText,
                done: false,
                continuation: continuationMode,
              }) + "\n"
            )
          );
        }

        // Send final complete message
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              done: true,
              text: responseText,
              continuation: continuationMode,
            }) + "\n"
          )
        );

        // Close the stream
        controller.close();
      } catch (error) {
        // Handle errors in the stream
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: true,
              text: "Error in streaming response: " + error.message,
              done: true,
            }) + "\n"
          )
        );
        controller.close();
      }
    },
  });

  // Return the stream as a response
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    },
  });
}

/**
 * Convert conversation history to proper format for the chat
 * @param {Array} history - The conversation history array
 * @returns {Array} - Properly formatted history for the API
 */
function formatChatHistory(history) {
  if (!history || history.length === 0) {
    return [];
  }

  return history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.parts[0].text }],
  }));
}

/**
 * Handle the first phase: information gathering (non-streaming version)
 * @param {string} userInput - User's current input
 * @param {Array} conversationHistory - Previous conversation history, if any
 * @param {boolean} continuationMode - Whether this is continuing a cut-off response
 * @param {string} partialResponse - The partial response that was cut off
 * @returns {Object} - Response object with text and conversation history
 */
async function handleInformationGathering(
  userInput,
  conversationHistory = [],
  continuationMode = false,
  partialResponse = ""
) {
  const model = initializeGeminiModel();

  // Initialize chat
  let chat;
  let aiOutput;

  if (continuationMode && partialResponse) {
    // For continuation mode, we'll include the partial response in the prompt
    const continuationPrompt = `The previous response was cut off. Here was the partial response: "${partialResponse}". Please continue from where you left off.`;

    // We use the history but we'll directly ask for continuation
    chat = model.startChat({
      history: formatChatHistory(conversationHistory),
    });

    // Send the continuation request
    const result = await chat.sendMessage(continuationPrompt);
    const continuationOutput = result.response.text();

    // Combine the partial and continuation response
    aiOutput = partialResponse + continuationOutput;

    // Update conversation history with the complete response
    // Remove the last model response if it was partial
    if (
      conversationHistory.length > 0 &&
      conversationHistory[conversationHistory.length - 1].role === "model"
    ) {
      conversationHistory.pop();
    }

    conversationHistory.push({
      role: "model",
      parts: [{ text: aiOutput }],
    });
  } else {
    // If this is a new conversation, start directly with user input
    // System instructions are provided in the model configuration
    if (!conversationHistory || conversationHistory.length === 0) {
      // Initialize with an empty chat - system instructions are in model config
      chat = model.startChat();

      // Send the user's first message
      const result = await chat.sendMessage(userInput);
      aiOutput = result.response.text();

      // Initialize conversation history with just this first exchange
      conversationHistory = [
        {
          role: "user",
          parts: [{ text: userInput }],
        },
        {
          role: "model",
          parts: [{ text: aiOutput }],
        },
      ];
    } else {
      // For existing conversations, use the history
      chat = model.startChat({
        history: formatChatHistory(conversationHistory),
      });

      // Send the user's message
      const result = await chat.sendMessage(userInput);
      aiOutput = result.response.text();

      // Add the current interaction to conversation history
      conversationHistory.push({
        role: "user",
        parts: [{ text: userInput }],
      });

      conversationHistory.push({
        role: "model",
        parts: [{ text: aiOutput }],
      });
    }
  }

  // Check if the information gathering phase is complete
  const isComplete = aiOutput.includes("## FINAL SUMMARY ##");
  let projectInformation = "";

  if (isComplete) {
    projectInformation = aiOutput;
  }

  return {
    text: aiOutput,
    conversationHistory: conversationHistory,
    isComplete: isComplete,
    projectInformation: projectInformation,
    continuation: continuationMode,
  };
}

/**
 * Handle the second phase: tool recommendation (non-streaming version)
 * @param {string} projectInformation - The gathered project information
 * @param {boolean} continuationMode - Whether this is continuing a cut-off response
 * @param {string} partialResponse - The partial response that was cut off
 * @returns {Object} - Response object with the recommendations
 */
async function handleToolRecommendation(
  projectInformation,
  continuationMode = false,
  partialResponse = ""
) {
  // Read the tool information from file
  let toolInformation;
  let productUrls;
  try {
    toolInformation = await readFromFile("tool_information.txt");
    productUrls = await readFromFile("product_urls.txt");
  } catch (error) {
    console.error("Error reading information files:", error);
    return {
      text: "Error: Unable to access tool information or product URLs. Please try again later.",
      error: true,
    };
  }

  const model = initializeGeminiModel();
  let result;
  let resultText;

  if (continuationMode && partialResponse) {
    // For continuation mode, we'll ask the model to continue from where it left off
    const continuationPrompt = `The previous response was cut off. Here was the partial response: "${partialResponse}". Please continue from where you left off without repeating any content.`;

    // Send the continuation prompt to Gemini API
    result = await model.generateContent(continuationPrompt);
    const continuationText = result.response.text();

    // Combine the partial and continuation response
    resultText = partialResponse + continuationText;
  } else {
    // Normal mode - generate the initial response
    const prompt = PROMPT_TEMPLATE.replace(
      "{project_information}",
      projectInformation
    )
      .replace("{tool_information}", toolInformation)
      .replace("{product_urls_file}", productUrls);

    // Send the prompt to Gemini API
    result = await model.generateContent(prompt);
    resultText = result.response.text();
  }

  return {
    text: resultText,
    error: false,
    continuation: continuationMode,
  };
}

/**
 * Helper function to read content from a file
 * @param {string} filename - The name of the file
 * @returns {string} - The file content
 */
async function readFromFile(filename) {
  try {
    const filePath = path.join(process.cwd(), "public", filename);
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    console.error(`Error reading from ${filename}:`, error);
    throw error;
  }
}
// The improved prompt for the information gathering phase
const IMPROVED_PROMPT = `
You are an expert consultant for a tool hire business. Your primary task is to:
1. Ask the customer a set of specific questions about their project.
2. Identify any unclear or incomplete answers, and ask follow-up questions when necessary (explaining why each clarification is needed).
3. Once all necessary details are obtained, produce a comprehensive "Customer Project Information" summary. This summary will be used to determine tool hire recommendations (tool type and hire duration).

## Important Note to Customers
- If you're unsure about any question or prefer not to answer, please feel free to say "I don't know" or "I'd prefer to skip this question." We understand that not all information may be available, and we'll work with whatever details you can provide.

## Available Tool Categories
Our business offers tools in the following categories, which you should keep in mind when asking questions and seeking clarifications:

### Breaking & Drilling
- Electric Breakers
- Hydraulic Breakers
- Magnetic Drill

### Access Equipment
- Non-Mechanical: Scaffold Tower, Podium Steps
- Powered Access: Cherry Pickers

### Cleaning & Floorcare
- Pressure Washers
- Vacuum Cleaners

### Concrete & Compaction
- Compactor Plates
- Concrete Finishing
- Concrete Mixers
- Concrete Poker Units
- Trench Rammers
- Vibrating Rollers

### Drilling & Fixing
- Hammer Drills
- Electric Sanders
- Nail Guns
- Planers

### Cutting & Grinding
- Pipe Cutting
- Cut-Off Saws
- Floor Saws
- Reciprocating Saws
- Splitters
- Wall Chasing Machine

### Heating, Drying & Cooling
- Drying Equipment
- Gas Heaters

### Gardening & Landscaping
- Log Splitters
- Blowers/Vacuums
- Brush Cutters
- Earth Augers
- Garden Hand Tools
- Ground Cultivation
- Hedge Trimmers
- Lawn Scarifiers
- Post Pullers
- Seeders
- Shredders/Chippers
- Stump Grinders
- Turf Cutters

### Building & Site Equipment
- Supports
- Tile Cutters
- Excavator Attachments
- Mini Excavators

### Surveying Equipment
- Cable Detection
- Cable Reels
- Laser Levels

### Lift & Shift Equipment
- Material Lifts
- Site Dumpers

### Lighting & Power
- Petrol Generators
- Transformers

### Plumbing & Pumping
- Submersible Pumps
- Petrol Pumps

## Instructions:
1. Begin by asking about the customer's project to gather key information.
2. If any critical information is missing, ask for clarification once, explaining why this detail would be helpful.
3. Once sufficient details are obtained, create a "Customer Project Information" summary in your own words.

## Primary Questions to Ask:
1. What project are you planning to work on? Please describe your project in detail and explain its main goal. For example, are you building a deck, remodeling a bathroom, or installing new kitchen cabinets?
2. Have you completed a similar project before? If yes, what tools did you find most useful? If no, what is your experience level with similar work?
3. How large is the project area (e.g., room dimensions, linear feet for a fence, square footage for flooring)?
4. What types of materials will you be working with (e.g., wood, concrete, tile, metal, composite, drywall)?
5. Are there any space limitations (e.g., narrow hallways, limited clearance, small workspaces) that might affect tool size or maneuverability?
6. Is your project in a residential, commercial, or industrial setting? (Different settings may have regulations or power supply constraints.)
7. Do you have a specific deadline or timeframe for completing the project?
8. Are you working on the project full-time, or only on weekends/evenings?
9. Is your project indoors, outdoors, or both? For outdoor projects, what is the terrain like and are there any access issues?
10. Are there any additional considerations or details you want to share that might affect the tools or methods you need? (e.g., noise restrictions, power availability, environmental concerns)

## Optional Follow-up Questions by Category:
Depending on the project type, you might consider asking these additional questions if relevant:

### For Breaking & Drilling Projects:
- What type of material needs to be broken or drilled (concrete, masonry, metal)?
- How thick is the material you need to break or drill through?

### For Access Equipment Projects:
- What is the maximum height you need to reach?
- Is the work area on level ground or uneven terrain?

### For Concrete & Compaction Projects:
- What volume of concrete will you be mixing/working with?
- What is the depth and area of compaction required?

### For Gardening & Landscaping Projects:
- What is the size of the garden/landscape area?
- Are there any existing trees, stumps, or heavy growth that needs removal?

### For Cutting & Sawing Projects:
- What is the thickness and type of material being cut?
- Do you need precision cuts or rough cuts?

## Remember:
- Work with whatever level of detail the customer is able or willing to provide.
- Use your knowledge of our tool categories to suggest appropriate equipment they might not have considered.
- Provide the final "Customer Project Information" summary when you have gathered sufficient information to make tool recommendations.
- Clearly mark the final summary with the prefix "## FINAL SUMMARY ##"
`;

// The prompt template for the tool recommendation phase
const PROMPT_TEMPLATE = `You are an expert tool consultant for a tool hire business. Your main objective 
is to determine which tools a customer needs and how long they need them for, based on their project 
details. You have access to detailed project information and tool inventory details, provided at the 
end of this prompt.

Your Tasks:
1. Introduction
   - Briefly restate the project as you understand it, based on the supplied project details.
2. Tool Recommendations
   - Recommend the specific tools that best fit the project requirements.
   - Explain why each recommended tool is suitable (e.g., power requirements, capacity, safety features, efficiency).
   - If the customer already owns any of the recommended equipment, they can disregard that specific recommendation.
   - If the experience level of the user is unclear, label each tool as either "Easy to use" or "Requires experience" to guide their selection.
   - Include the URL for each recommended product by matching the product name with the corresponding URL in the product URLs file.
3. Recommended Hire Duration
   - Provide an estimated timeframe for how long each recommended tool should be hired to complete the project.
   - Justify your estimate (e.g., typical usage patterns, project scope, professional guidelines).
4. Acknowledge Uncertainties
   - If any information is insufficient or unclear, clearly state the uncertainty.
   - Specify what additional details would be needed for a more accurate recommendation.
5. Additional Notes
   - Include any caveats, safety tips, or best practices relevant to the recommended tools.
   - Use direct language (e.g., "Be mindful of noise restrictions" rather than "Remind the customer to be mindful of noise restrictions").

Important:
- Use only the information provided in the project information, tool information, and product URL sections below.
- If the information is contradictory or incomplete, highlight the issue and explain how it affects your recommendation.
- If you are unsure about any tool selection or hire duration, explicitly mention that and request further details.

---
Below are the three sources of information you have available:
Project Information:
{project_information}

Tool Information:
{tool_information}

Product URLs:
{product_urls_file}
`;

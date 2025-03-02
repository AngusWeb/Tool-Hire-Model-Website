// File: app/api/tool-recommendation/route.js
import { promises as fs } from "fs";
import path from "path";

// API key for Google's Gemini API
const API_KEY = "AIzaSyBvrYL4Mh6qRsnokxaPIJg6qnYV5rHlzYE";

/**
 * API route handler for Next.js
 * @param {Request} request - The incoming request
 * @returns {Response} - The API response
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { phase, userInput, conversationContext, projectInformation } = body;

    if (phase === "gathering") {
      // Handle the information gathering phase
      const result = await handleInformationGathering(
        userInput,
        conversationContext
      );
      return Response.json(result);
    } else if (phase === "recommendation") {
      // Handle the tool recommendation phase
      const result = await handleToolRecommendation(projectInformation);
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
  } catch (error) {
    console.error("Error processing request:", error);
    return Response.json(
      {
        error: true,
        text: "An error occurred while processing your request.",
      },
      { status: 500 }
    );
  }
}

/**
 * Handle the first phase: information gathering
 * @param {string} userInput - User's initial input
 * @param {string} conversationContext - Previous conversation context, if any
 * @returns {Object} - Response object with text and conversation context
 */
async function handleInformationGathering(userInput, conversationContext) {
  // If this is a new conversation, initialize the context with the improved prompt
  if (!conversationContext) {
    conversationContext = "System:\n" + IMPROVED_PROMPT + "\n\n";
    conversationContext += `User: ${
      userInput || "Hello! I'd like to discuss my project."
    }\n`;
  } else {
    // Otherwise, append the new user input to the existing conversation
    conversationContext += `\nUser: ${userInput}\n`;
  }

  // Send the conversation to Gemini API
  const response = await fetchGeminiResponse(
    conversationContext,
    "gemini-2.0-flash"
  );
  const aiOutput = response.text;

  // Check if the information gathering phase is complete
  const isComplete = aiOutput.includes("FINAL SUMMARY");
  let projectInformation = "";

  if (isComplete) {
    projectInformation = aiOutput;
    // In a real app, you might want to save this to a database instead of a file
    // Commented out file operations which might cause issues in serverless environments
    // await saveToFile("project_information.txt", projectInformation);
  }

  // Add the AI response to the conversation context for future reference
  conversationContext += `\nAI: ${aiOutput}\n`;

  return {
    text: aiOutput,
    conversationContext: conversationContext,
    isComplete: isComplete,
    projectInformation: projectInformation,
  };
}

/**
 * Handle the second phase: tool recommendation
 * @param {string} projectInformation - The gathered project information
 * @returns {Object} - Response object with the recommendations
 */
async function handleToolRecommendation(projectInformation) {
  // Read the tool information from file
  let toolInformation;
  try {
    toolInformation = await readFromFile("tool_information.txt");
  } catch (error) {
    console.error("Error reading tool information:", error);
    return {
      text: "Error: Unable to access tool information. Please try again later.",
      error: true,
    };
  }

  // Create the prompt for tool recommendations
  const prompt = PROMPT_TEMPLATE.replace(
    "{project_information}",
    projectInformation
  ).replace("{tool_information}", toolInformation);

  // Send the prompt to Gemini API
  const response = await fetchGeminiResponse(prompt, "gemini-2.0-flash");
  const resultText = response.text;

  // File operations commented out for serverless environments
  // await saveToFile("recommendations.txt", resultText);

  return {
    text: resultText,
    error: false,
  };
}

/**
 * Helper function to fetch a response from the Gemini API
 * @param {string} content - The content to send to the API
 * @param {string} model - The model to use
 * @returns {Object} - The API response
 */
async function fetchGeminiResponse(content, model) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: content }] }],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("No response from Gemini API");
    }

    // Extract the text from the response
    const text = data.candidates[0].content.parts[0].text;
    return { text };
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return { text: "Error generating response. Please try again." };
  }
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
2. Identify any unclear or incomplete answers, and ask follow-up questions (explaining why each clarification is needed).
3. Once all necessary details are obtained, produce a comprehensive "Customer Project Information" summary. This summary will be used to determine tool hire recommendations (tool type and hire duration).

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
1. Begin by asking the following questions (one at a time if needed) to gather information about the customer's project.
2. If any responses are unclear or missing critical information, politely ask for clarification and explain why you need that detail.
3. Once all necessary details are obtained, create a "Customer Project Information" summary in your own words.

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

## Follow-up Questions by Category:
Based on the customer's initial responses, ask targeted follow-up questions related to potentially relevant tool categories:

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
- If the customer's answers are incomplete, politely ask for more details and explain why you need them.
- Use your knowledge of our tool categories to suggest appropriate equipment they might not have considered.
- Only provide the final "Customer Project Information" summary when you have gathered enough information that can be used to recommend tools and hire durations.
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

3. Recommended Hire Duration
   - Provide an estimated timeframe for how long each recommended tool should be hired to complete the project.
   - Justify your estimate (e.g., typical usage patterns, project scope, professional guidelines).

4. Acknowledge Uncertainties
   - If any information is insufficient or unclear, clearly state the uncertainty.
   - Specify what additional details would be needed for a more accurate recommendation.

5. Additional Notes
   - Include any caveats, safety tips, or best practices relevant to the recommended tools.

Important:
- Use only the information provided in the project information and tool information sections below.
- If the information is contradictory or incomplete, highlight the issue and explain how it affects your recommendation.
- If you are unsure about any tool selection or hire duration, explicitly mention that and request further details.

---
Below are the two sources of information you have available:

Project Information:
{project_information}

Tool Information:
{tool_information}
`;

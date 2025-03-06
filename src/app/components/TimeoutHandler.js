// File: components/TimeoutHandler.js
import { useEffect, useRef } from "react";

/**
 * A custom hook to handle timeouts when communicating with the LLM
 * @param {Object} options - Options for the timeout handler
 * @param {Function} options.onTimeout - Function to call when a timeout is detected
 * @param {Function} options.fetchFunction - The API fetch function being used
 * @param {number} options.timeoutThreshold - Timeout threshold in milliseconds (default: 8000ms)
 * @returns {Object} - Object containing helper functions
 */
export function useTimeoutHandler({
  onTimeout,
  fetchFunction,
  timeoutThreshold = 8000, // Set slightly below Vercel's 10s limit
}) {
  const timeoutRef = useRef(null);
  const responseRef = useRef("");
  const isStreamingRef = useRef(false);

  // Clear any existing timeout
  const clearTimeoutTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Reset timeout timer
  const resetTimeoutTimer = () => {
    clearTimeoutTimer();

    if (isStreamingRef.current) {
      timeoutRef.current = setTimeout(() => {
        console.log("Timeout detected, initiating continuation...");

        // Call the provided onTimeout function with the partial response
        if (onTimeout) {
          onTimeout(responseRef.current);
        }

        isStreamingRef.current = false;
      }, timeoutThreshold);
    }
  };

  // Start tracking a streaming response
  const startStreamTracking = () => {
    isStreamingRef.current = true;
    responseRef.current = "";
    resetTimeoutTimer();
  };

  // Update the response content as chunks arrive
  const updateResponseContent = (chunk) => {
    responseRef.current += chunk;
    resetTimeoutTimer();
  };

  // Finish streaming
  const finishStreamTracking = () => {
    clearTimeoutTimer();
    isStreamingRef.current = false;
  };

  // Wrapper for fetch function to handle timeouts
  const fetchWithTimeoutHandling = async (endpoint, payload) => {
    // If this is a continuation request, don't start new tracking
    if (!payload.continuationMode) {
      startStreamTracking();
    }

    try {
      const result = await fetchFunction(endpoint, payload);

      // For streaming responses, the fetch function should call updateResponseContent
      // for each chunk and finishStreamTracking when done

      // For non-streaming responses, update the full response and finish tracking
      if (!payload.streaming) {
        if (result && result.text) {
          updateResponseContent(result.text);
        }
        finishStreamTracking();
      }

      return result;
    } catch (error) {
      // If there's an error, check if we should handle it as a timeout
      if (isStreamingRef.current) {
        // This might be a timeout error, call onTimeout with the partial response
        onTimeout(responseRef.current);
      }

      finishStreamTracking();
      throw error;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeoutTimer();
    };
  }, []);

  return {
    fetchWithTimeoutHandling,
    updateResponseContent,
    finishStreamTracking,
    startStreamTracking,
    clearTimeoutTimer,
    getCurrentPartialResponse: () => responseRef.current,
  };
}

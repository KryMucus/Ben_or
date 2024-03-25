import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState, defaultState } from "../types";
import axios from "axios"; // Assuming axios is used for HTTP requests

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());
  

  let nodeState: NodeState = { ...defaultState, x: initialValue,  };
  let participating = false; // Flag to indicate if the node is participating in the consensus

  const receivedValues: { [parsedValue: string]: number } = {}; // To track the count of received values

  // Utility function to broadcast messages to all other nodes
  const broadcastMessage = async (message: any) => {
    const requests = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        const request = axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, message, { timeout: 5000 }).catch(error => {
          // Handle individual errors or log them, without throwing the error to avoid Promise.all failing fast
          console.error(`Node ${nodeId} failed to send message to node ${i}: ${error.message}`);
        });
        requests.push(request);
      }
    }
    await Promise.allSettled(requests);
  };
  
  

  // Route for retrieving the current status of the node
node.get("/status", (req, res) => {
  if (isFaulty) {
    res.status(500).send("faulty"); // Return plain text "faulty" for faulty nodes
  } else {
    res.status(200).send("live"); // Return plain text "live" for healthy nodes
  }
});

  // Route for getting the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).json(nodeState);
  });

  node.post("/message", (req, res) => {
    if (!participating || isFaulty || nodeState.k === null) {
      console.log(`Node ${nodeId} not participating, is faulty, or round counter is not initialized`);
      res.status(400).send("Node not participating, is faulty, or round counter is not initialized");
      return;
    }
  
    const { value, senderId, round } = req.body;
  
    // Ensure parsedValue is treated as a number when it's 0 or 1
    let parsedValue: Value;
    if (value === 0 || value === 1) { // Directly compare with numeric values
      parsedValue = value;
    } else if (value === "?") {
      parsedValue = "?";
    } else {
      console.error("Invalid value received:", value);
      res.status(400).send("Invalid value received");
      return;
    }
  
    // If the message is from a future round, update the node's round
    if (round > nodeState.k) {
      nodeState.k = round;
    }
  
    console.log(`Node ${nodeId} received value ${parsedValue} from node ${senderId} in round ${round}`);
  
    // Update the count for received value
    const valueAsString = String(parsedValue); // Use a string key for consistency in receivedValues object
    receivedValues[valueAsString] = (receivedValues[valueAsString] || 0) + 1;
  
    // Determine the number of running nodes
    const runningNodes = N - F;
  
    // Check if a value has been received from more than half of the RUNNING nodes
    for (const val in receivedValues) {
     // Assuming Value is defined as 0 | 1 | "?"
      if (receivedValues[val] > runningNodes / 2) {
        // Majority found, update node's value and round
        nodeState.x = val === "?" ? "?" : parseInt(val, 10) as 0 | 1; // Assert that parsed value is of type 0 | 1
        if (nodeState.k === null) {
          nodeState.k = 0;
        }
        nodeState.k++; // Move to the next round
        nodeState.decided = true; // Node has made a decision
        console.log(`Node ${nodeId} updates its value to ${val} in round ${nodeState.k}`);
        broadcastMessage({ value: nodeState.x, senderId: nodeId, round: nodeState.k });

      } else if (receivedValues[val] === runningNodes / 2) {
        // Tie: Use a randomized value and update round
        const randomValue = Math.random() < 0.5 ? 0 : 1; // Directly assign 0 or 1
        nodeState.x = randomValue as 0 | 1; // Assert that randomValue is of type 0 | 1
        if (nodeState.k === null) {
          nodeState.k = 0;
        }
        nodeState.k++; // Move to the next round
        console.log(`Node ${nodeId} resolves tie with random value ${randomValue} in round ${nodeState.k}`);
        broadcastMessage({ value: nodeState.x, senderId: nodeId, round: nodeState.k });
      }

        
    res.status(200).send("Message received and processed");}
  });
  
  
  

  // Route to start the consensus algorithm
node.get("/start", async (req, res) => {
  if (!isFaulty) {
    participating = true;
    nodeState.k = 0; // Initialize the round counter when consensus starts
    // Broadcast initial value to all other nodes
    await broadcastMessage({ value: nodeState.x, senderId: nodeId, round: nodeState.k });
    res.status(200).send("Consensus algorithm started");
  } else {
    res.status(400).send("Faulty node cannot start consensus");
  }
});


  // Corrected /stop route
node.get("/stop", (req, res) => {
  participating = false; // Correctly indicate the node has stopped participating
  nodeState = { ...defaultState, killed: true };
  res.status(200).send("Node stopped");
});

  // Start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId); // Mark the node as ready
  });

  return server;
}

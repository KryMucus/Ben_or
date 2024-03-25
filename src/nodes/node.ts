import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState, defaultState } from "../types";
import axios from "axios"; // Assuming axios is used for HTTP requests
import { delay } from "../utils";

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
  
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

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
  
  // Route to start the consensus algorithm
  node.get("/start", async (req, res) => {
    // Wait for all nodes to be ready
    while (!nodesAreReady()) {
      await delay(100); // Wait for 100ms before checking again
    }
  
    if (isFaulty) {
      // If the node is faulty, it does not participate in the consensus
      console.log(`Node ${nodeId} is faulty and will not start the consensus process.`);
      res.status(400).send("Faulty node cannot start consensus");
    } else {
      // Initialize the node's state for the consensus process
      participating = true; // Mark the node as participating in the consensus
      nodeState.k = 0; // Initialize the round counter
      nodeState.x = initialValue; // Set the initial value
      nodeState.decided = false; // Mark the node as undecided
  
      // Broadcast the initial value to all other nodes to start the consensus process
      const message = { value: nodeState.x, senderId: nodeId, round: nodeState.k, type: "2P" }; // Type "2P" indicates this is a proposal message
      broadcastMessage(message).then(() => {
        console.log(`Node ${nodeId} broadcasted initial value: ${JSON.stringify(message)}`);
      }).catch(error => {
        console.error(`Node ${nodeId} failed to broadcast initial value: ${error.message}`);
      });
  
      res.status(200).send("Consensus algorithm started");
    }
  });




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


  const ensureArrayForKey = (map: Map<number, Value[]>, key: number): Value[] => {
    if (!map.has(key)) {
      map.set(key, []);
    }
    return map.get(key)!; // Using non-null assertion since we just set the key if it didn't exist
  };
  
  // Function to determine the decision based on vote counts
  const determineDecision = (countNo: number, countYes: number, N: number, F: number): Value => {
    if (countNo > N / 2) {
      return 0;
    } else if (countYes > N / 2) {
      return 1;
    } else if (countNo >= F + 1) {
      return 0; // Decided no
    } else if (countYes >= F + 1) {
      return 1; // Decided yes
    } else {
      // Randomized decision in case of no clear majority
      return Math.random() > 0.5 ? 0 : 1;
    }
  };
  
  node.post("/message", async (req, res) => {
    if (!participating || isFaulty || nodeState.k === null) {
      res.status(400).send("Node not participating, is faulty, or round counter is not initialized");
      return;
    }
  
    const { value, senderId, round, type } = req.body;
  
    // Handle proposal messages
    if (type === "2P") {
      const proposalValues: Value[] = ensureArrayForKey(proposals, round);
      proposalValues.push(value);
  
      if (proposalValues.length >= N - F) {
        const countNo: number = proposalValues.filter((val: Value) => val === 0).length;
        const countYes: number = proposalValues.filter((val: Value) => val === 1).length;
  
        let decisionValue: Value = determineDecision(countNo, countYes, N, F);
  
        // Broadcast decision for voting if not "?"
        if (decisionValue !== "?") { // Type mismatch is addressed here by ensuring decisionValue cannot be "?"
          const voteMessage = { value: decisionValue, senderId: nodeId, round, type: "2V" };
          broadcastMessage(voteMessage);
        }
      }
    }
    // Handle vote messages
    else if (type === "2V") {
      const voteValues: Value[] = ensureArrayForKey(votes, round);
      voteValues.push(value);
  
      if (voteValues.length >= N - F) {
        const countNo: number = voteValues.filter((val: Value) => val === 0).length;
        const countYes: number = voteValues.filter((val: Value) => val === 1).length;
  
        nodeState.x = determineDecision(countNo, countYes, N, F);
        nodeState.decided = [0, 1].includes(+nodeState.x); // Ensures that decided is true only if x is 0 or 1
        if (!nodeState.decided) {
          nodeState.k = round + 1;
          // Prepare to initiate a new round of proposals
          const newProposalMessage = { value: nodeState.x, senderId: nodeId, round: nodeState.k, type: "2P" };
          broadcastMessage(newProposalMessage);
        }
      }
    }
  
    res.status(200).send("Message received and processed");
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

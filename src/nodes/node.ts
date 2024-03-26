import express from 'express';
import bodyParser from 'body-parser';
import { NodeState, Value } from '../types'; // Ensure these types are defined correctly in your project
import { BASE_NODE_PORT } from "../config";
import { delay } from "../utils"; // Ensure this function exists and works as expected

export async function node(
  nodeId: number,
  N: number, // Total number of nodes
  F: number, // Number of faulty nodes
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(bodyParser.json());

  let roundProposals: Map<number, Value[]> = new Map();
  let roundVotes: Map<number, Value[]> = new Map();
  let nodeStatus: NodeState = {
  killed: false,
  x: initialValue,
  decided: false,
  k: 0
  };

  const broadcast = async (data: any) => {
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i === nodeId) continue;
      const promise = fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).catch(console.error);
      promises.push(promise);
    }
    await Promise.all(promises);
  };
// Type definition for an action to be taken based on the decision logic
type DecisionAction = {
  k: number;
  x: Value;
  type: '2P' | '2V';
};

async function makeDecision(
  { k, x, type }: { k: number; x: Value; type: '2P' | '2V'; },
  roundProposals: Map<number, Value[]>,
  roundVotes: Map<number, Value[]>,
  nodeStatus: NodeState,
  N: number,
  F: number,
  isFaulty: boolean
): Promise<DecisionAction[]> {
  const actions: DecisionAction[] = [];

  if (!nodeStatus.killed && !isFaulty) {
    if (type === '2P') {
      const currentProposals = roundProposals.get(k) ?? [];
      currentProposals.push(x);
      roundProposals.set(k, currentProposals);

      if (currentProposals.length >= N - F) {
        const countNoVotes = currentProposals.filter(x => x === 0).length;
        const countYesVotes = currentProposals.filter(x => x === 1).length;
        let consensusValue: Value = countNoVotes > N / 2 ? 0 : countYesVotes > N / 2 ? 1 : '?';

        if (consensusValue !== '?') {
          for (let i = 0; i < N; i++) {
            actions.push({ k, x: consensusValue, type: '2V' });
          }
        }
      }
    } else if (type === '2V') {
      const currentVotes = roundVotes.get(k) ?? [];
      currentVotes.push(x);
      roundVotes.set(k, currentVotes);

      if (currentVotes.length >= N - F) {
        const countNoVotes = currentVotes.filter(x => x === 0).length;
        const countYesVotes = currentVotes.filter(x => x === 1).length;

        if (countNoVotes >= F + 1) {
          nodeStatus.x = 0;
          nodeStatus.decided = true;
        } else if (countYesVotes >= F + 1) {
          nodeStatus.x = 1;
          nodeStatus.decided = true;
        } else {
          nodeStatus.x = countNoVotes + countYesVotes > 0 && countNoVotes > countYesVotes ? 0 : countNoVotes + countYesVotes > 0 && countNoVotes < countYesVotes ? 1 : Math.random() > 0.5 ? 0 : 1;
          nodeStatus.k = k + 1;

          for (let i = 0; i < N; i++) {
            actions.push({ k: nodeStatus.k, x: nodeStatus.x, type: '2P' });
          }
        }
      }
    }
  }

  return actions;
}


app.get("/getState", (req, res) => {
  if (isFaulty) {
    res.send({
      killed: nodeStatus.killed,
      x: null,
      decided: null,
      k: null,
    });
  } else {
    res.send(nodeStatus);
  }
});

  
app.get("/start", async (req, res) => {
  // Wait until all nodes are ready
  while (!nodesAreReady()) {
    await delay(100);
  }

  // Reset or set the initial state
  nodeStatus.k = 1;
  nodeStatus.x = initialValue;
  nodeStatus.decided = false;

  // Broadcast the initial message to all nodes, including itself
  for (let i = 0; i < N; i++) {
    fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        k: nodeStatus.k,
        x: nodeStatus.x,
        type: "2P",
      }),
    }).catch(console.error); // Handle fetch errors, for example, when the node is not reachable
  }

  // Respond to the request indicating that the consensus process has started
  res.status(200).send("Consensus process initiated successfully.");
});


  app.post('/message', async (req, res) => {
    const { k, x, type } = req.body;
  
    if (nodeStatus.killed || isFaulty) {
      res.status(500).send('Node not participating');
      return;
    }
  
    const actions = await makeDecision(req.body, roundProposals, roundVotes, nodeStatus, N, F, isFaulty); 
  
  
    // Execute the actions returned by makeDecision
    for (const action of actions) {
      await broadcast({ k: action.k, x: action.x, type: action.type });
    }
  
    res.status(200).send("success");
  });
  

  app.get('/stop', (req, res) => {
    nodeStatus.killed = true;
    nodeStatus.x = null;
    nodeStatus.decided = null;
    nodeStatus.k = 0;
    res.status(200).send('Node stopped');
  });

  app.get("/status", (req, res) => {
    if (nodeStatus.killed || isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  const server = app.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId); // Signal that this node is ready
    app.locals.currentState = nodeStatus; // Initialize and store the currentState in app.locals for consistent state management
  });

  return server;
}

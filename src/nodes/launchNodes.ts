import { Value } from "../types";
import { node } from "./node";

export async function launchNodes(
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValues: Value[], // initial values of each node
  faultyList: boolean[] // list indicating whether each node is faulty
) {
  if (initialValues.length !== faultyList.length || N !== initialValues.length) {
    throw new Error("Arrays don't match in length.");
  }
  if (faultyList.filter((el) => el === true).length !== F) {
    throw new Error("The number of faulty nodes in faultyList does not match F.");
  }

  // Array to track readiness of each node
  const readinessArray = new Array(N).fill(false);

  // Function to check if all nodes are ready
  const nodesAreReady = () => readinessArray.every(isReady => isReady);

  // Function to mark a node as ready
  const setNodeIsReady = (index: number) => {
    readinessArray[index] = true;
  };

  // Launch each node with its respective initial value and faulty status
  const promises = initialValues.map((initialValue, index) =>
    node(
      index,
      N,
      F,
      initialValue,
      faultyList[index],
      nodesAreReady,
      setNodeIsReady
    )
  );
  

// Wait for all nodes to be launched
const servers = await Promise.all(promises);

// Polling mechanism to wait for all nodes to be ready
const checkReadiness = async () => {
  const pollInterval = 1000; // 1 second
  const timeout = 30000; // 30 seconds
  let elapsed = 0;

  return new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      if (nodesAreReady()) {
        clearInterval(poll);
        resolve();
      } else if (elapsed >= timeout) {
        clearInterval(poll);
        reject(new Error("Timeout waiting for nodes to be ready."));
      }
      elapsed += pollInterval;
    }, pollInterval);
  });
};

// Wait until all nodes are ready or timeout occurs
try {
  await checkReadiness();
  console.log("All nodes are ready. Starting consensus algorithm.");
  // Additional logic to start the consensus can be placed here
} catch (error:any) {
  console.error(error.message);
}

return servers;
}
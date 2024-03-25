export type NodeState = {
  killed: boolean;
  x: Value | null;
  decided: boolean | null;
  k: number | null;
};

export type Value = 0 | 1 | "?";


export const defaultState :NodeState = {
  killed : false,
  x : null,
  decided : null,
  k : null
}
import { CombinedState } from "redux"
import { ExecutionResult, graphql, GraphQLSchema } from "graphql"
import { getNode } from "../../../../datastore"
import { store } from "../../../../redux"
import {
  IGatsbyPage,
  IGatsbyPageComponent,
  IGatsbyState,
  IGatsbyStaticQueryComponents,
} from "../../../../redux/types"
import { ITypeMetadata } from "../../../../schema/infer/inference-metadata"
import reporter from "gatsby-cli/lib/reporter"
import apiRunner from "../../../api-runner-node"
import withResolverContext from "../../../../schema/context"

// re-export all usual methods from production worker
export * from "../../child"
export { setState } from "../../child/state"

// additional functions to be able to write assertions that won't be available in production code

// test: datastore
export function getNodeFromWorker(nodeId: string): ReturnType<typeof getNode> {
  return getNode(nodeId)
}

// test:share-state
export function getPage(pathname: string): IGatsbyPage | undefined {
  return store.getState().pages.get(pathname)
}
export function getComponent(
  componentPath: IGatsbyPageComponent["componentPath"]
): IGatsbyPageComponent | undefined {
  return store.getState().components.get(componentPath)
}
export function getStaticQueryComponent(
  id: IGatsbyStaticQueryComponents["id"]
): IGatsbyStaticQueryComponents | undefined {
  return store.getState().staticQueryComponents.get(id)
}
export function getInferenceMetadata(typeName: string): ITypeMetadata {
  return store.getState().inferenceMetadata.typeMap[typeName]
}

// test: reporter
export function log(message: string): boolean {
  reporter.log(message)
  return true
}

// test: config
export async function runAPI(apiName: string): Promise<any> {
  return await apiRunner(apiName)
}

// test: config
export function getAPIRunResult(): string | undefined {
  return (global as any).test
}

export function getState(): CombinedState<IGatsbyState> {
  return store.getState()
}

const runQuery = (
  schema: GraphQLSchema,
  schemaComposer,
  query: string
): Promise<ExecutionResult> =>
  graphql(
    schema,
    query,
    undefined,
    withResolverContext({
      schema,
      schemaComposer,
      context: {},
      customContext: {},
    })
  )

// test: schema
export async function getRunQueryResult(
  query: string
): Promise<ExecutionResult> {
  const state = store.getState()

  return await runQuery(state.schema, state.schemaCustomization.composer, query)
}

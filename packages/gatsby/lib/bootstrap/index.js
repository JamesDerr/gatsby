/* @flow */
const Promise = require(`bluebird`)
const glob = require(`glob`)
const _ = require(`lodash`)
const slash = require(`slash`)
const fs = require(`fs-extra`)
const md5File = require(`md5-file/promise`)
const crypto = require(`crypto`)
const path = require(`path`)

const apiRunnerNode = require(`../utils/api-runner-node`)
const { graphql } = require(`graphql`)
const { store } = require(`../redux`)
const { boundActionCreators } = require(`../redux/actions`)
const loadPlugins = require(`./load-plugins`)
const jsPageCreator = require(`./js-page-creator`)
const { initCache } = require(`../utils/cache`)

// Override console.log to add the source file + line number.
// Useful for debugging if you lose a console.log somewhere.
// Otherwise leave commented out.
// require(`./log-line-function`)

// Start off the query running.
const QueryRunner = require(`../query-runner`)

const preferDefault = m => (m && m.default) || m

module.exports = async (program: any) => {
  console.log(`lib/bootstrap/index.js time since started:`, process.uptime())

  // Fix program directory path for windows env
  program.directory = slash(program.directory)

  store.dispatch({
    type: `SET_PROGRAM`,
    payload: program,
  })

  QueryRunner.watch(program.directory)

  // Try opening the site's gatsby-config.js file.
  console.time(`open and validate gatsby-config.js`)
  let config = {}
  try {
    // $FlowFixMe
    config = preferDefault(require(`${program.directory}/gatsby-config`))
  } catch (e) {
    console.log(`Couldn't open your gatsby-config.js file`)
    console.log(e)
    process.exit()
  }

  store.dispatch({
    type: `SET_SITE_CONFIG`,
    payload: config,
  })

  console.timeEnd(`open and validate gatsby-config.js`)

  const flattenedPlugins = await loadPlugins(config)

  // Ensure the public directory is created.
  await mkdirs(`${program.directory}/public`)

  // Copy our site files to the root of the site.
  console.time(`copy gatsby files`)
  const srcDir = `${__dirname}/../cache-dir`
  const siteDir = `${program.directory}/.cache`
  try {
    // await removeDir(siteDir)
    await copy(srcDir, siteDir, { clobber: true })
    await mkdirs(`${program.directory}/.cache/json`)
  } catch (e) {
    console.log(`Unable to copy site files to .cache`)
    console.log(e)
  }

  // Find plugins which implement gatsby-browser and gatsby-ssr and write
  // out api-runners for them.
  const hasAPIFile = (env, plugin) =>
    glob.sync(`${plugin.resolve}/gatsby-${env}*`)[0]

  const ssrPlugins = _.filter(
    flattenedPlugins.map(plugin => ({
      resolve: hasAPIFile(`ssr`, plugin),
      options: plugin.pluginOptions,
    })),
    plugin => plugin.resolve
  )
  const browserPlugins = _.filter(
    flattenedPlugins.map(plugin => ({
      resolve: hasAPIFile(`browser`, plugin),
      options: plugin.pluginOptions,
    })),
    plugin => plugin.resolve
  )

  let browserAPIRunner = fs.readFileSync(
    `${siteDir}/api-runner-browser.js`,
    `utf-8`
  )
  const browserPluginsRequires = browserPlugins
    .map(
      plugin => `{
      plugin: require('${plugin.resolve}'),
      options: ${JSON.stringify(plugin.options)},
    }`
    )
    .join(`,`)

  browserAPIRunner = `var plugins = [${browserPluginsRequires}]\n${browserAPIRunner}`

  let sSRAPIRunner = fs.readFileSync(`${siteDir}/api-runner-ssr.js`, `utf-8`)
  const ssrPluginsRequires = ssrPlugins
    .map(
      plugin => `{
      plugin: require('${plugin.resolve}'),
      options: ${JSON.stringify(plugin.options)},
    }`
    )
    .join(`,`)
  sSRAPIRunner = `var plugins = [${ssrPluginsRequires}]\n${sSRAPIRunner}`

  fs.writeFileSync(
    `${siteDir}/api-runner-browser.js`,
    browserAPIRunner,
    `utf-8`
  )
  fs.writeFileSync(`${siteDir}/api-runner-ssr.js`, sSRAPIRunner, `utf-8`)

  console.timeEnd(`copy gatsby files`)

  // Create Schema.
  await require(`../schema`)()

  const graphqlRunner = (query, context) => {
    const schema = store.getState().schema
    return graphql(schema, query, context, context, context)
  }

  // Collect resolvable extensions and attach to program.
  const extensions = [`.js`, `.jsx`]
  const apiResults = await apiRunnerNode(`resolvableExtensions`)

  store.dispatch({
    type: `SET_PROGRAM_EXTENSIONS`,
    payload: _.flattenDeep([extensions, apiResults]),
  })

  // Collect pages.
  await apiRunnerNode(`createPages`, {
    graphql: graphqlRunner,
  })

  // TODO move this to own source plugin per component type
  // (js/cjsx/typescript, etc.). Only do after there's themes
  // so can cement default /pages setup in default core theme.
  autoPathCreator()

  // Copy /404/ to /404.html as many static site hosting companies expect
  // site 404 pages to be named this.
  // https://www.gatsbyjs.org/docs/add-404-page/
  const exists404html = _.some(
    store.getState().pages,
    p => p.path === `/404.html`
  )
  if (!exists404html) {
    store.getState().pages.forEach(page => {
      if (page.path === `/404/`) {
        boundActionCreators.upsertPage({
          ...page,
          path: `/404.html`,
        })
      }
    })
  }

  console.log(`created js pages`)

  return new Promise(resolve => {
    QueryRunner.isInitialPageQueryingDone(() => {
      apiRunnerNode(`generateSideEffects`).then(() => {
        console.log(
          `bootstrap finished, time since started: ${process.uptime()}`
        )
        resolve({ graphqlRunner })
      })
    })
  })
}

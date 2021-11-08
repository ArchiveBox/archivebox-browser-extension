const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin')
const package = require('./package.json')
const targetManifest = require(`./src/manifest.${process.env.TARGET_BROWSER || "chrome"}.json`)

module.exports = {
  devtool: false,
  mode: process.env.NODE_ENV || "production",
  entry: {
    background: "./src/background/index.ts",
    action: "./src/action/index.ts"
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist")
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/
      },
      {
        test: /\.(html|svelte)$/,
        use: "svelte-loader"
      },
      {
        test: /node_modules\/svelte\/.*\.mjs$/,
        resolve: {
          fullySpecified: false
        }
      }
    ]
  },
  optimization: {
    usedExports: true
  },
  resolve: {
    alias: {
      svelte: path.resolve("node_modules", "svelte")
    },
    extensions: [ ".tsx", ".ts", ".js", ".mjs", ".svelte" ],
    mainFields: [ "svelte", "browser", "module", "main" ]
  },
  plugins: [
    new CleanPlugin({
      cleanStaleWebpackAssets: false
    }),
    new CopyPlugin({
      patterns: [
        {
          from: "./src/manifest.json",
          to: "manifest.json",
          transform(content) {
            const manifest = JSON.parse(content.toString())
            manifest.version = package.version
            manifest.description = package.description
            for(const key in targetManifest)
              manifest[key] = targetManifest[key]
            return JSON.stringify(manifest)
          }
        },
        {
          from: "./static/**",
          to: "."
        }
      ]
    })
  ]
}

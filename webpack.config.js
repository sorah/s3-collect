const path = require("path");
const glob = require("glob");
const HtmlWebpackHarddiskPlugin = require('html-webpack-harddisk-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

const { NODE_ENV } = process.env;
const isProd = NODE_ENV === "production";

const entries = {};
glob.sync("ui/packs/*.{ts,tsx}").forEach(filePath => {
  const name = path.basename(filePath, path.extname(filePath));
  entries[name] = path.resolve(__dirname, filePath);
});

module.exports = {
  mode: isProd ? "production" : "development",
  devtool: "source-map",
  entry: entries,
  output: {
    path: path.resolve(__dirname, "dist", "ui"),
    publicPath: "/",
    filename: isProd ? "[name]-[hash].js" : "[name].js"
  },
  optimization: {
    //splitChunks: {
    //  name: "vendor",
    //  chunks: "initial"
    //},
    minimize: isProd,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            ecma: "2017",
          },
        }
      }),
    ],
  },
  resolve: {
    extensions: [".js", ".ts", ".tsx"]
  },
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: [MiniCssExtractPlugin.loader, "css-loader", "sass-loader"]
      },
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
        }
      },
      {
        test: /\.woff2?$|\.ttf$|\.eot$|\.svg$|\.png$|\.jpg$/,
        loader: 'file-loader?&name=assets/[hash].[ext]',
      },
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './ui/index.html',
      hash: isProd,
      inject: false,
      alwaysWriteToDisk: true,
    }),
    new MiniCssExtractPlugin({
      filename: isProd ? "[name]-[hash].css" : "[name].css"
    }),
    new HtmlWebpackHarddiskPlugin({
      outputPath: './dist/ui',
    }),
  ],
  devServer: {
    contentBase: path.join(__dirname, 'dist', 'ui'),
    compress: true,
    port: 9000,
    proxy: {
      '/api-prd': 'http://localhost:4567',
    },
    historyApiFallback: {
      rewrites: [
        { from: /./, to: '/index.html' },
      ],
    },
  }
};

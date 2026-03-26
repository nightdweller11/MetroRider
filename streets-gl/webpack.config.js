const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const {EsbuildPlugin} = require('esbuild-loader');

const childProcess = require('child_process');
const {DefinePlugin} = require("webpack");

function tryExec(cmd, fallback) {
	try { return childProcess.execSync(cmd).toString().trim(); }
	catch { return fallback; }
}

const COMMIT_SHA = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA || tryExec('git rev-parse HEAD', 'unknown');
const COMMIT_BRANCH = process.env.COOLIFY_BRANCH || process.env.GITHUB_REF_NAME || tryExec('git rev-parse --abbrev-ref HEAD', 'unknown');
const VERSION = require('./package.json').version;

const sharedRules = (mode) => [
	{
		test: /\.vert|.frag|.glsl$/i,
		use: [{loader: 'raw-loader', options: {esModule: false}}]
	},
	{test: /\.css$/i, use: [MiniCssExtractPlugin.loader, 'css-loader']},
	{
		test: /\.s[ac]ss$/i,
		use: [
			'style-loader',
			{loader: 'css-loader', options: {importLoaders: 1, url: false, modules: true}},
			'sass-loader'
		],
		sideEffects: true
	},
	{
		test: /\.[jt]sx?$/,
		loader: 'esbuild-loader',
		options: {
			target: 'es2020',
			tsconfig: mode === 'production' ? 'tsconfig.prod.json' : 'tsconfig.json'
		}
	},
];

const sharedResolve = {
	extensions: ['.ts', '.js', '.tsx'],
	alias: {'~': path.resolve(__dirname, 'src')},
	fallback: {url: require.resolve('url'), path: require.resolve('path-browserify'), fs: false}
};

module.exports = (env, argv) => {
	const mode = argv.mode || 'development';
	return [
	{
		mode,
		entry: './src/app/App.ts',
		output: {
			filename: './js/index.[contenthash].js',
			path: path.resolve(__dirname, 'build')
		},
		performance: {maxEntrypointSize: 8000000, maxAssetSize: 8000000},
		optimization: {minimizer: [new EsbuildPlugin({target: 'es2020'})]},
		devServer: {
			hot: true,
			proxy: [{context: ['/api', '/data/assets'], target: 'http://localhost:3001'}],
			historyApiFallback: {
				rewrites: [
					{from: /^\/settings\.html$/, to: '/settings.html'},
					{from: /^\/settings$/, to: '/settings.html'},
				],
			},
		},
		devtool: mode === 'production' ? undefined : 'inline-source-map',
		plugins: [
			new CleanWebpackPlugin({
				cleanStaleWebpackAssets: true,
				cleanOnceBeforeBuildPatterns: ['index.html', 'main.css', 'js/index.*'],
			}),
			new HtmlWebpackPlugin({
				filename: 'index.html',
				template: './src/index.html',
				minify: mode === 'production'
			}),
			new MiniCssExtractPlugin(),
			new CopyPlugin({
				patterns: [
					{from: './src/resources/textures', to: path.resolve(__dirname, 'build/textures')},
					{from: './src/resources/models', to: path.resolve(__dirname, 'build/models')},
					{from: './src/resources/images', to: path.resolve(__dirname, 'build/images')},
					{from: './src/resources/misc', to: path.resolve(__dirname, 'build/misc')}
				]
			}),
			new ESLintPlugin({context: './src', extensions: ['ts', 'tsx']}),
			new DefinePlugin({
				COMMIT_SHA: JSON.stringify(COMMIT_SHA),
				COMMIT_BRANCH: JSON.stringify(COMMIT_BRANCH),
				VERSION: JSON.stringify(VERSION)
			})
		],
		module: {rules: sharedRules(mode)},
		resolve: sharedResolve
	},
	{
		mode,
		entry: './src/settings/SettingsApp.tsx',
		output: {
			filename: './js/settings.[contenthash].js',
			path: path.resolve(__dirname, 'build')
		},
		performance: {maxEntrypointSize: 2000000, maxAssetSize: 2000000},
		optimization: {minimizer: [new EsbuildPlugin({target: 'es2020'})]},
		devtool: mode === 'production' ? undefined : 'inline-source-map',
		plugins: [
			new HtmlWebpackPlugin({
				filename: 'settings.html',
				template: './src/settings/settings.html',
				minify: mode === 'production'
			}),
		],
		module: {
			rules: [
				...sharedRules(mode).filter(r => !String(r.test).includes('\\.css')),
				{test: /\.css$/i, use: ['style-loader', 'css-loader']},
			]
		},
		resolve: sharedResolve
	}
];
};

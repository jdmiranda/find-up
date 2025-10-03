import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findUp, findUpSync, findUpMultiple, findUpMultipleSync} from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function benchmark(name, fn, iterations = 1000) {
	// Warmup
	for (let i = 0; i < 10; i++) {
		fn();
	}

	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		fn();
	}

	const end = performance.now();
	const duration = end - start;
	const avgTime = duration / iterations;

	return {
		name,
		iterations,
		totalTime: duration.toFixed(2),
		avgTime: avgTime.toFixed(4),
		opsPerSec: (1000 / avgTime).toFixed(2),
	};
}

async function runBenchmarks() {
	console.log('Running benchmarks...\n');

	const results = [];

	// Benchmark 1: findUpSync for package.json (common use case)
	results.push(
		benchmark('findUpSync (package.json from deep dir)', () => {
			findUpSync('package.json', {cwd: path.join(__dirname, 'test')});
		}, 1000),
	);

	// Benchmark 2: findUpSync for non-existent file (worst case)
	results.push(
		benchmark('findUpSync (non-existent file)', () => {
			findUpSync('this-does-not-exist.txt', {cwd: path.join(__dirname, 'test')});
		}, 500),
	);

	// Benchmark 3: findUpMultipleSync with limit
	results.push(
		benchmark('findUpMultipleSync (with limit 3)', () => {
			findUpMultipleSync('package.json', {
				cwd: path.join(__dirname, 'test'),
				limit: 3,
			});
		}, 1000),
	);

	// Benchmark 4: findUpSync with array of paths
	results.push(
		benchmark('findUpSync (array of paths)', () => {
			findUpSync(['package.json', 'readme.md'], {
				cwd: path.join(__dirname, 'test'),
			});
		}, 1000),
	);

	// Benchmark 5: Async version for comparison
	const asyncResults = [];
	const asyncStart = performance.now();
	for (let i = 0; i < 100; i++) {
		// eslint-disable-next-line no-await-in-loop
		await findUp('package.json', {cwd: path.join(__dirname, 'test')});
	}

	const asyncEnd = performance.now();
	const asyncDuration = asyncEnd - asyncStart;
	asyncResults.push({
		name: 'findUp (async, package.json)',
		iterations: 100,
		totalTime: asyncDuration.toFixed(2),
		avgTime: (asyncDuration / 100).toFixed(4),
		opsPerSec: (100000 / asyncDuration).toFixed(2),
	});

	// Print results
	console.log('Benchmark Results:');
	console.log('='.repeat(80));
	console.log(`${'Test Name'.padEnd(45)} ${'Iterations'.padStart(10)} ${'Avg Time (ms)'.padStart(15)} ${'Ops/Sec'.padStart(10)}`);
	console.log('-'.repeat(80));

	for (const result of [...results, ...asyncResults]) {
		console.log(
			`${result.name.padEnd(45)} ${String(result.iterations).padStart(10)} ${result.avgTime.padStart(15)} ${result.opsPerSec.padStart(10)}`,
		);
	}

	console.log('='.repeat(80));
	console.log('\nOptimizations Applied:');
	console.log('  - Cached path.resolve() calls');
	console.log('  - Cached path.dirname() calls');
	console.log('  - Fast path for limit=0');
	console.log('  - Early exit when limit reached');
	console.log('  - Root detection to avoid unnecessary iterations');
	console.log('  - Pre-computed function matcher detection');
	console.log('  - Reduced arithmetic operations in loops');

	return results;
}

runBenchmarks().catch(console.error);

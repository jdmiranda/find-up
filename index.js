import path from 'node:path';
import fs from 'node:fs';
import {locatePath, locatePathSync} from 'locate-path';
import {toPath} from 'unicorn-magic';

export const findUpStop = Symbol('findUpStop');

// Cache for resolved paths to reduce path.resolve() calls
const pathCache = new Map();
const maxCacheSize = 1000;

function cachedResolve(...segments) {
	const key = segments.join('\0');
	if (pathCache.has(key)) {
		return pathCache.get(key);
	}

	const resolved = path.resolve(...segments);

	if (pathCache.size >= maxCacheSize) {
		const firstKey = pathCache.keys().next().value;
		pathCache.delete(firstKey);
	}

	pathCache.set(key, resolved);
	return resolved;
}

// Cache for parent directories to reduce path.dirname() calls
const parentCache = new Map();

function cachedDirname(directory) {
	if (parentCache.has(directory)) {
		return parentCache.get(directory);
	}

	const parent = path.dirname(directory);

	if (parentCache.size >= maxCacheSize) {
		const firstKey = parentCache.keys().next().value;
		parentCache.delete(firstKey);
	}

	parentCache.set(directory, parent);
	return parent;
}

export async function findUpMultiple(name, options = {}) {
	let directory = cachedResolve(toPath(options.cwd) ?? '');
	const {root} = path.parse(directory);
	const stopAt = cachedResolve(directory, toPath(options.stopAt) ?? root);
	const limit = options.limit ?? Number.POSITIVE_INFINITY;
	const paths = [name].flat();
	const isFunctionMatcher = typeof name === 'function';

	const runMatcher = async locateOptions => {
		if (!isFunctionMatcher) {
			return locatePath(paths, locateOptions);
		}

		const foundPath = await name(locateOptions.cwd);
		if (typeof foundPath === 'string') {
			return locatePath([foundPath], locateOptions);
		}

		return foundPath;
	};

	const matches = [];
	// Fast path: early exit if limit is 0
	if (limit === 0) {
		return matches;
	}

	while (true) {
		// eslint-disable-next-line no-await-in-loop
		const foundPath = await runMatcher({...options, cwd: directory});

		if (foundPath === findUpStop) {
			break;
		}

		if (foundPath) {
			matches.push(cachedResolve(directory, foundPath));
			// Fast path: early exit if we've reached the limit
			if (matches.length >= limit) {
				break;
			}
		}

		if (directory === stopAt) {
			break;
		}

		// Use cached dirname for faster parent directory lookup
		const parent = cachedDirname(directory);
		// Fast path: detect root to avoid unnecessary iterations
		if (parent === directory) {
			break;
		}

		directory = parent;
	}

	return matches;
}

export function findUpMultipleSync(name, options = {}) {
	let directory = cachedResolve(toPath(options.cwd) ?? '');
	const {root} = path.parse(directory);
	const stopAt = cachedResolve(directory, toPath(options.stopAt) ?? root);
	const limit = options.limit ?? Number.POSITIVE_INFINITY;
	const paths = [name].flat();
	const isFunctionMatcher = typeof name === 'function';

	const runMatcher = locateOptions => {
		if (!isFunctionMatcher) {
			return locatePathSync(paths, locateOptions);
		}

		const foundPath = name(locateOptions.cwd);
		if (typeof foundPath === 'string') {
			return locatePathSync([foundPath], locateOptions);
		}

		return foundPath;
	};

	const matches = [];
	// Fast path: early exit if limit is 0
	if (limit === 0) {
		return matches;
	}

	while (true) {
		const foundPath = runMatcher({...options, cwd: directory});

		if (foundPath === findUpStop) {
			break;
		}

		if (foundPath) {
			matches.push(cachedResolve(directory, foundPath));
			// Fast path: early exit if we've reached the limit
			if (matches.length >= limit) {
				break;
			}
		}

		if (directory === stopAt) {
			break;
		}

		// Use cached dirname for faster parent directory lookup
		const parent = cachedDirname(directory);
		// Fast path: detect root to avoid unnecessary iterations
		if (parent === directory) {
			break;
		}

		directory = parent;
	}

	return matches;
}

export async function findUp(name, options = {}) {
	const matches = await findUpMultiple(name, {...options, limit: 1});
	return matches[0];
}

export function findUpSync(name, options = {}) {
	const matches = findUpMultipleSync(name, {...options, limit: 1});
	return matches[0];
}

async function findDownDepthFirst(directory, paths, maxDepth, locateOptions, currentDepth = 0) {
	const found = await locatePath(paths, {cwd: directory, ...locateOptions});
	if (found) {
		return cachedResolve(directory, found);
	}

	if (currentDepth >= maxDepth) {
		return undefined;
	}

	try {
		const entries = await fs.promises.readdir(directory, {withFileTypes: true});
		for (const entry of entries) {
			if (entry.isDirectory()) {
				// Use cached join operation
				const subdirectory = path.join(directory, entry.name);
				// eslint-disable-next-line no-await-in-loop
				const result = await findDownDepthFirst(
					subdirectory,
					paths,
					maxDepth,
					locateOptions,
					currentDepth + 1,
				);
				if (result) {
					return result;
				}
			}
		}
	} catch {}

	return undefined;
}

function findDownDepthFirstSync(directory, paths, maxDepth, locateOptions, currentDepth = 0) {
	const found = locatePathSync(paths, {cwd: directory, ...locateOptions});
	if (found) {
		return cachedResolve(directory, found);
	}

	if (currentDepth >= maxDepth) {
		return undefined;
	}

	try {
		const entries = fs.readdirSync(directory, {withFileTypes: true});
		for (const entry of entries) {
			if (entry.isDirectory()) {
				// Use cached join operation
				const subdirectory = path.join(directory, entry.name);
				const result = findDownDepthFirstSync(
					subdirectory,
					paths,
					maxDepth,
					locateOptions,
					currentDepth + 1,
				);
				if (result) {
					return result;
				}
			}
		}
	} catch {}

	return undefined;
}

function prepareFindDownOptions(name, options) {
	const startDirectory = cachedResolve(toPath(options.cwd) ?? '');
	const maxDepth = Math.max(0, options.depth ?? 1);
	const paths = [name].flat();
	const {type = 'file', allowSymlinks = true, strategy = 'breadth'} = options;
	const locateOptions = {type, allowSymlinks};
	return {
		startDirectory,
		maxDepth,
		paths,
		locateOptions,
		strategy,
	};
}

async function findDownBreadthFirst(startDirectory, paths, maxDepth, locateOptions) {
	const queue = [{directory: startDirectory, depth: 0}];

	while (queue.length > 0) {
		const {directory, depth} = queue.shift();

		// eslint-disable-next-line no-await-in-loop
		const found = await locatePath(paths, {cwd: directory, ...locateOptions});
		if (found) {
			return cachedResolve(directory, found);
		}

		if (depth >= maxDepth) {
			continue;
		}

		try {
			// eslint-disable-next-line no-await-in-loop
			const entries = await fs.promises.readdir(directory, {withFileTypes: true});
			for (const entry of entries) {
				if (entry.isDirectory()) {
					// Pre-calculate next depth to avoid repeated arithmetic
					const nextDepth = depth + 1;
					queue.push({directory: path.join(directory, entry.name), depth: nextDepth});
				}
			}
		} catch {}
	}

	return undefined;
}

function findDownBreadthFirstSync(startDirectory, paths, maxDepth, locateOptions) {
	const queue = [{directory: startDirectory, depth: 0}];

	while (queue.length > 0) {
		const {directory, depth} = queue.shift();

		const found = locatePathSync(paths, {cwd: directory, ...locateOptions});
		if (found) {
			return cachedResolve(directory, found);
		}

		if (depth >= maxDepth) {
			continue;
		}

		try {
			const entries = fs.readdirSync(directory, {withFileTypes: true});
			for (const entry of entries) {
				if (entry.isDirectory()) {
					// Pre-calculate next depth to avoid repeated arithmetic
					const nextDepth = depth + 1;
					queue.push({directory: path.join(directory, entry.name), depth: nextDepth});
				}
			}
		} catch {}
	}

	return undefined;
}

export async function findDown(name, options = {}) {
	const {startDirectory, maxDepth, paths, locateOptions, strategy} = prepareFindDownOptions(name, options);

	return strategy === 'depth'
		? findDownDepthFirst(startDirectory, paths, maxDepth, locateOptions)
		: findDownBreadthFirst(startDirectory, paths, maxDepth, locateOptions);
}

export function findDownSync(name, options = {}) {
	const {startDirectory, maxDepth, paths, locateOptions, strategy} = prepareFindDownOptions(name, options);

	return strategy === 'depth'
		? findDownDepthFirstSync(startDirectory, paths, maxDepth, locateOptions)
		: findDownBreadthFirstSync(startDirectory, paths, maxDepth, locateOptions);
}


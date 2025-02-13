import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { inkMLToSvg } from './PathConverter'

/**
 * Converts all InkML files in the mathwriting directory to SVG files
 * Why: To visualize the mathematical handwriting data for analysis and testing
 */
async function convert_inkml_to_svg() {
	try {
		const read_dir_path = join(__dirname, 'mathwriting_data')
		const write_dir_path = join(__dirname, 'mathwriting_data/svgs')

		// Get all InkML files recursively
		const inkml_files = await get_files_recursively(read_dir_path, '.inkml')
		console.log('found', inkml_files.length, 'files')

		// Calculate how many files make up 1%
		const files_per_percent = inkml_files.length / 100
		let last_percent_logged = 0

		for (const [index, file_path] of inkml_files.entries()) {
			// Calculate current percentage and log if we've passed another percent
			const current_percent = Math.floor(index / files_per_percent)
			if (current_percent > last_percent_logged) {
				console.log(`${current_percent}% complete`)
				last_percent_logged = current_percent
			}

			const inkml_content = await readFile(file_path, 'utf-8')

			// Create corresponding SVG path in a flat directory structure
			const file_name = file_path.split('/').pop()?.replace('.inkml', '.svg') ?? ''
			const svg_path = join(write_dir_path, file_name)

			// Ensure the output directory exists (only needs to be done once, but keeping it here for safety)
			await mkdir(write_dir_path, { recursive: true })

			// Extract label from InkML content
			const label_match = inkml_content.match(/<annotation type="label">(.*?)<\/annotation>/)
			const label = label_match ? label_match[1] : ''

			// Validate InkML content
			if (!inkml_content || typeof inkml_content !== 'string') {
				console.warn(`Skipping ${file_path}: Invalid InkML content`)
				continue
			}

			// Convert to SVG with default options
			let svg_result = await inkMLToSvg(inkml_content.trim(), {
				size: 16,
				thinning: 0.5,
				smoothing: 0.5,
				streamline: 0.4,
				last: true,
			})

			// Validate SVG conversion result
			if (!svg_result) {
				console.warn(`Skipping ${file_path}: SVG conversion failed`)
				continue
			}

			let svg_content = svg_result

			// Extract path data to calculate bounds
			const path_matches = svg_content.match(/d="([^"]+)"/g) || []
			const points = path_matches.flatMap((path) => {
				const coords = path.match(/-?\d+\.?\d*/g) || []
				return coords.map(Number)
			})

			// Calculate viewBox if we have points
			let view_box = '0 0 1000 1000' // fallback
			if (points.length > 0) {
				const x_coords = points.filter((_, i) => i % 2 === 0)
				const y_coords = points.filter((_, i) => i % 2 === 1)
				const min_x = Math.floor(Math.min(...x_coords))
				const min_y = Math.floor(Math.min(...y_coords))
				const max_x = Math.ceil(Math.max(...x_coords))
				const max_y = Math.ceil(Math.max(...y_coords))
				const padding = 10 // Add some padding around the content
				view_box = `${min_x - padding} ${min_y - padding} ${max_x - min_x + 2 * padding} ${max_y - min_y + 2 * padding}`
			}

			// Add viewport, white background, and label with calculated viewBox
			svg_content = svg_content.replace(
				'<svg',
				`<svg width="100%" height="100%" viewBox="${view_box}" style="background-color: white;"`
			)
			svg_content += `\n<label><latex>${label}</latex></label>`

			// Save with the same name but .svg extension
			await writeFile(svg_path, svg_content)
		}

		return { value: `Converted ${inkml_files.length} files successfully` }
	} catch (error: unknown) {
		return {
			err: `Failed to convert files: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Gets all files with a specific extension from a directory using an iterative approach
 * Why: Prevents stack overflow when dealing with deeply nested directory structures
 * @param dir_path - The directory to search in
 * @param extension - The file extension to look for
 */
async function get_files_recursively(dir_path: string, extension: string): Promise<string[]> {
	const paths: string[] = []
	const dirs_to_process: string[] = [dir_path]

	while (dirs_to_process.length > 0) {
		const current_dir = dirs_to_process.pop()!

		const files = await readdir(current_dir, { withFileTypes: true })

		for (const file of files) {
			const full_path = join(current_dir, file.name)
			if (file.isDirectory()) {
				dirs_to_process.push(full_path)
			} else if (file.name.endsWith(extension)) {
				paths.push(full_path)
			}
		}
	}

	return paths
}

// Execute the conversion
async function main() {
	const result = await convert_inkml_to_svg()
	if (result.err) {
		console.error(result.err)
		process.exit(1)
	} else {
		console.log(result.value)
	}
	process.exit(0)
}

main().catch((error) => {
	console.error('Unhandled error:', error)
	process.exit(1)
})

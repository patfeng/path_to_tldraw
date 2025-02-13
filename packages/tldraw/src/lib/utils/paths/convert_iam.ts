import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { iamToSvg } from './PathConverter'

/**
 * Converts IAM dataset XML files to SVG files
 * Handles both the original text files and line stroke files
 */
async function convert_iam_to_svg() {
	try {
		const base_dir = new URL('.', import.meta.url).pathname
		const original_dir = join(base_dir, 'iam_data/original')
		const line_strokes_dir = join(base_dir, 'iam_data/lineStrokes')
		const write_dir = join(base_dir, 'iam_data/svgs')

		// Create output directory
		await mkdir(write_dir, { recursive: true })

		// Process original files to get text labels
		const text_labels = new Map<string, string>()

		// Recursively get all strokesz.xml files from original directory
		async function get_strokesz_files(dir: string): Promise<string[]> {
			const entries = await readdir(dir, { withFileTypes: true })
			const files = await Promise.all(
				entries.map((entry) => {
					const path = join(dir, entry.name)
					if (entry.isDirectory()) {
						return get_strokesz_files(path)
					} else if (entry.name === 'strokesz.xml') {
						return [path]
					}
					return []
				})
			)
			return files.flat()
		}

		const strokesz_files = await get_strokesz_files(original_dir)
		console.log(`Found ${strokesz_files.length} strokesz.xml files`)

		// Process strokesz files to get text labels and IDs
		const text_line_info = new Map<string, { text: string; id: string }>()
		for (const file of strokesz_files) {
			const content = await readFile(file, 'utf-8')
			const text_lines = content.match(/<TextLine[^>]*>/g)
			if (text_lines) {
				// console.log(file_id)
				// Get the first TextLine's ID and text
				const first_line = text_lines[0]
				const id_match = first_line.match(/id="([^"]*)"/)
				const text_match = first_line.match(/text="([^"]*)"/)
				if (id_match && text_match) {
					text_line_info.set(id_match[1], {
						text: text_match[1],
						id: id_match[1],
					})
				}
			}
		}

		// Process line strokes files
		async function process_line_strokes(dir: string) {
			const entries = await readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				console.log(entry.name)
				const path = join(dir, entry.name)
				if (entry.isDirectory()) {
					await process_line_strokes(path)
				} else if (entry.name.endsWith('.xml')) {
					const xml_content = await readFile(path, 'utf-8')
					const file_id = entry.name.replace('.xml', '')
					// Generate SVG
					let svg_content = await iamToSvg(xml_content, {
						size: 32,
						thinning: 0.5,
						smoothing: 0.5,
						streamline: 0.4,
						last: true,
					})

					// Calculate viewBox from path data
					const path_matches = svg_content.match(/d="([^"]+)"/g) || []
					const points = path_matches.flatMap((path) => {
						const coords = path.match(/-?\d+\.?\d*/g) || []
						return coords.map(Number)
					})

					let view_box = '0 0 1000 1000' // fallback
					if (points.length > 0) {
						const x_coords = points.filter((_, i) => i % 2 === 0)
						const y_coords = points.filter((_, i) => i % 2 === 1)
						const min_x = Math.floor(Math.min(...x_coords))
						const min_y = Math.floor(Math.min(...y_coords))
						const max_x = Math.ceil(Math.max(...x_coords))
						const max_y = Math.ceil(Math.max(...y_coords))
						const padding = 10
						view_box = `${min_x - padding} ${min_y - padding} ${max_x - min_x + 2 * padding} ${max_y - min_y + 2 * padding}`
					}

					const info = text_line_info.get(file_id)
					if (!info?.text) {
						console.log(`Skipping ${file_id} - no text label found`)
						continue
					}

					// Add viewport and white background
					svg_content = svg_content.replace(
						'<svg',
						`<svg width="100%" height="100%" viewBox="${view_box}" style="background-color: white;"`
					)

					// Add file identifier and text label
					svg_content += `\n<label><text>${info.text}</text></label>`

					// Save SVG using TextLine ID as filename
					const file_name = `${file_id}.svg`
					const output_path = join(write_dir, file_name)
					await writeFile(output_path, svg_content)
					console.log(`Saved ${output_path}`)
				}
			}
		}

		await process_line_strokes(line_strokes_dir)
		return { value: 'Conversion completed successfully' }
	} catch (error: unknown) {
		console.error('Error details:', error)
		return {
			err: `Failed to convert files: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

async function main() {
	const result = await convert_iam_to_svg()
	if (result.err) {
		console.error(result.err)
		process.exit(1)
	} else {
		console.log(result.value)
		process.exit(0)
	}
}

main().catch((error) => {
	console.error('Unhandled error:', error)
	process.exit(1)
})

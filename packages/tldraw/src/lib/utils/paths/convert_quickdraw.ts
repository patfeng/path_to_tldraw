import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { QuickDrawStroke, quickdrawToSvgPaths } from './PathConverter'

type QuickDrawData = {
	recognized: boolean
	drawing: QuickDrawStroke[]
}

async function process_ndjson_files() {
	try {
		// Use current directory for paths
		const read_dir = './quickdraw_data/ndjsons'
		const write_dir = './quickdraw_data/svgs'

		// Create output directory if it doesn't exist
		await mkdir(write_dir, { recursive: true })

		const files = await readdir(read_dir)
		console.log('Reading from:', read_dir)

		const ndjson_files = files
			.filter((file) => file.endsWith('.ndjson'))
			.map((file) => join(read_dir, file))

		console.log('Found', ndjson_files.length, 'NDJSON files to process')
		console.log(ndjson_files)
		for (const file_path of ndjson_files) {
			const category = file_path.split('/').pop()?.split('.')[0]
			console.log(`Processing ${category}...`)

			const content = await readFile(file_path, 'utf-8')
			const lines = content.split('\n').filter(Boolean)

			let finished = 0
			for (const line of lines) {
				if (finished >= 15) break

				const data = JSON.parse(line) as QuickDrawData
				if (!data.recognized) continue

				const paths = await quickdrawToSvgPaths(data.drawing)

				let svg_content = `<svg xmlns="http://www.w3.org/2000/svg">
					${paths.map((d) => `<path d="${d}" stroke="none" fill="#3a3c42"/>`).join('\n')}
				</svg>`

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
					const padding = 10 // Add some padding around the content
					view_box = `${min_x - padding} ${min_y - padding} ${max_x - min_x + 2 * padding} ${max_y - min_y + 2 * padding}`
				}

				svg_content = svg_content.replace(
					'<svg',
					`<svg width="100%" height="100%" viewBox="${view_box}" style="background-color: white;"`
				)
				svg_content += `\n<label><diagram type="${category}"/></label>`

				const output_path = join(write_dir, `${category}_${finished}.svg`)
				await writeFile(output_path, svg_content)
				console.log(`Saved ${output_path}`)
				finished++
			}
		}

		return { value: 'Conversion completed successfully' }
	} catch (error: unknown) {
		console.log('Error details:', error)
		return {
			err: `Failed to convert files: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

async function main() {
	const result = await process_ndjson_files()
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

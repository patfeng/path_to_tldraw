import { Vec, getSvgPathFromPoints } from '@tldraw/editor'
import { parseStringPromise } from 'xml2js'
import { getStrokeOutlinePoints } from '../../shapes/shared/freehand/getStrokeOutlinePoints'
import { getStrokePoints } from '../../shapes/shared/freehand/getStrokePoints'
import { setStrokePointRadii } from '../../shapes/shared/freehand/setStrokePointRadii'
import { StrokeOptions } from '../../shapes/shared/freehand/types'

export type QuickDrawStroke = [number[], number[], number[]]

interface InkMLTrace {
	points: Array<{
		x: number
		y: number
		t: number
	}>
}

interface InkMLData {
	traces: InkMLTrace[]
}

interface IAMPoint {
	x: number
	y: number
	time: number
}

interface IAMStroke {
	colour: string
	start_time: string
	end_time: string
	points: IAMPoint[]
}

interface IAMData {
	strokes: IAMStroke[]
}

function parseXYT(raw_points: Array<{ x: number; y: number; t: number }>) {
	const points: Array<{ x: number; y: number; t: number }> = []

	// Interpolate between points
	for (let i = 0; i < raw_points.length - 1; i++) {
		const p1 = raw_points[i]
		const p2 = raw_points[i + 1]
		const dt = p2.t - p1.t
		const steps = dt / 10 - 1 // Number of segments to divide each interval into

		// Add the current point
		points.push(p1)

		// Add interpolated points
		for (let step = 1; step < steps; step++) {
			const t = p1.t + (dt * step) / steps
			const ratio = step / steps
			points.push({
				x: p1.x + (p2.x - p1.x) * ratio,
				y: p1.y + (p2.y - p1.y) * ratio,
				t,
			})
		}
	}

	// Add the final point
	points.push(raw_points[raw_points.length - 1])
	return points
}

/**
 * Parse InkML XML string into structured data with interpolated points.
 * Adds additional points between existing points for smoother rendering.
 */
async function parseInkML(inkmlString: string): Promise<InkMLData> {
	const result = await parseStringPromise(inkmlString)
	const traces = result.ink.trace || []

	return {
		traces: traces.map((trace: any) => {
			const raw_points = trace._.trim()
				.split(',')
				.map((point: string) => {
					const [x, y, t] = point.trim().split(' ').map(Number)
					return { x, y, t }
				})

			return { points: parseXYT(raw_points) }
		}),
	}
}

async function parseQuickDraw(strokes: QuickDrawStroke[]) {
	return {
		traces: strokes.map((stroke) => {
			const [xs, ys, ts] = stroke
			const raw_points = xs.map((_, i) => ({
				x: xs[i],
				y: ys[i],
				t: ts[i],
			}))
			return { points: parseXYT(raw_points) }
		}),
	}
}

/**
 * Convert InkML trace points to tldraw stroke points
 */
function getStrokePathFromTrace(trace: InkMLTrace, options: StrokeOptions = {}) {
	// Convert InkML points to Vec format
	const points = trace.points.map((p) => new Vec(p.x, p.y))

	// Get stroke points with pressure and other properties
	const strokePoints = getStrokePoints(points, {
		size: 2,
		thinning: 0.5,
		smoothing: 0.5,
		streamline: 0.5,
		simulatePressure: true,
		last: true,
		...options,
	})

	// Set the radius for each point based on pressure
	setStrokePointRadii(strokePoints, options)

	// Get the outline points that form the stroke shape
	const outlinePoints = getStrokeOutlinePoints(strokePoints, options)

	// Convert to SVG path
	return getSvgPathFromPoints(outlinePoints)
}

/**
 * Convert InkML data to SVG paths
 */
export async function inkMLToSvgPaths(
	inkml: string,
	options: StrokeOptions = {}
): Promise<string[]> {
	const data = await parseInkML(inkml)
	return data.traces.map((trace) => getStrokePathFromTrace(trace, options))
}

export async function quickdrawToSvgPaths(
	quickdraw: QuickDrawStroke[],
	options: StrokeOptions = {}
): Promise<string[]> {
	const data = await parseQuickDraw(quickdraw)
	return data.traces.map((trace) => getStrokePathFromTrace(trace, options))
}

/**
 * Convert InkML data to a single SVG element
 */
export async function inkMLToSvg(
	inkml: string,
	options: StrokeOptions = {},
	svgOptions = { stroke: 'none', fill: '#3a3c42' }
): Promise<string> {
	const paths = await inkMLToSvgPaths(inkml, options)

	return `<svg xmlns="http://www.w3.org/2000/svg">
    ${paths.map((d) => `<path d="${d}" stroke="${svgOptions.stroke}" fill="${svgOptions.fill}"/>`).join('\n')}
  </svg>`
}

/**
 * Parse IAM XML stroke data into a structured format
 */
async function parseIAMStroke(xml: string): Promise<IAMData> {
	const parsed = await parseStringPromise(xml)
	const stroke_set = parsed.WhiteboardCaptureSession.StrokeSet[0]
	const strokes = stroke_set.Stroke.map((stroke: any) => {
		const raw_points = stroke.Point.map((point: any) => ({
			x: Number(point.$.x),
			y: Number(point.$.y),
			time: Number(point.$.time * 1000),
		}))

		const points = parseXYT(raw_points)
		return {
			colour: stroke.$.colour,
			start_time: stroke.$.start_time,
			end_time: stroke.$.end_time,
			points,
		}
	})

	return { strokes }
}

/**
 * Convert IAM stroke data to SVG paths
 */
export async function iamToSvgPaths(xml: string, options: StrokeOptions = {}): Promise<string[]> {
	const data = await parseIAMStroke(xml)
	return data.strokes.map((stroke) => {
		return getStrokePathFromTrace(
			{ points: stroke.points.map((p) => ({ x: p.x, y: p.y, t: Number(p.time) })) },
			options
		)
	})
}

/**
 * Convert IAM XML to a single SVG element
 */
export async function iamToSvg(
	xml: string,
	options: StrokeOptions = {},
	svgOptions = { stroke: 'none', fill: '#3a3c42' }
): Promise<string> {
	const paths = await iamToSvgPaths(xml, options)
	return `<svg xmlns="http://www.w3.org/2000/svg">
    ${paths.map((d) => `<path d="${d}" stroke="${svgOptions.stroke}" fill="${svgOptions.fill}"/>`).join('\n')}
  </svg>`
}

// export async function ndjsonLnToSvg(
// 	ndjsonln: string,
// 	options: StrokeOptions = {},
// 	svgOptions: { stroke: 'none', fill: '#3a3c42' }
// ): Promise<string> {
// 	const paths = await quickdrawToSvgPaths(ndjsonln, options)
// 	return `<svg xmlns="http://www.w3.org/2000/svg">
//     ${paths.map((d) => `<path d="${d}" stroke="${svgOptions.stroke}" fill="${svgOptions.fill}"/>`).join('\n')}
//   </svg>`
// }

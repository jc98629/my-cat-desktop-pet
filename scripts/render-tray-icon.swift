import AppKit
import Foundation

guard CommandLine.arguments.count == 4 else {
  FileHandle.standardError.write(Data("usage: render-tray-icon.swift input.svg output.png size\n".utf8))
  exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let size = Int(CommandLine.arguments[3]), size > 0 else {
  exit(2)
}

guard let sourceImage = NSImage(contentsOf: inputURL) else {
  FileHandle.standardError.write(Data("unable to read SVG source\n".utf8))
  exit(1)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: size,
  pixelsHigh: size,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  exit(1)
}

bitmap.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  exit(1)
}
NSGraphicsContext.current = context
context.imageInterpolation = .high
context.cgContext.clear(CGRect(x: 0, y: 0, width: size, height: size))
sourceImage.draw(
  in: NSRect(x: 0, y: 0, width: size, height: size),
  from: NSRect(origin: .zero, size: sourceImage.size),
  operation: .sourceOver,
  fraction: 1
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  exit(1)
}

try pngData.write(to: outputURL, options: .atomic)

var visiblePixels = 0
var minX = size
var minY = size
var maxX = -1
var maxY = -1
for y in 0..<size {
  for x in 0..<size where (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.01 {
    visiblePixels += 1
    minX = min(minX, x)
    minY = min(minY, y)
    maxX = max(maxX, x)
    maxY = max(maxY, y)
  }
}

print("rendered \(size)x\(size), visible pixels: \(visiblePixels), bounds: \(minX),\(minY)-\(maxX),\(maxY)")

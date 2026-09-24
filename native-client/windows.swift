import Foundation
import CoreGraphics
let windows=CGWindowListCopyWindowInfo([.optionAll,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
for w in windows {let owner=w[kCGWindowOwnerName as String] as? String ?? "";if owner.lowercased().contains("java") || owner.lowercased().contains("minecraft"){print(w)}}

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
int main(){@autoreleasepool{NSArray *ws=(__bridge_transfer NSArray*)CGWindowListCopyWindowInfo(kCGWindowListOptionAll|kCGWindowListExcludeDesktopElements,kCGNullWindowID);for(NSDictionary*w in ws){NSString*n=w[(id)kCGWindowOwnerName];if([n.lowercaseString containsString:@"java"]||[n.lowercaseString containsString:@"minecraft"])NSLog(@"%@",w);}}return 0;}

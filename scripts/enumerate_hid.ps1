# AuraKey HID Device Enumerator
# Enumerates all HID and USB devices to identify what interfaces the
# connected controller exposes (XInput, vendor HID, etc.)

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  AuraKey - HID and USB Device Enumerator" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. XInput / Xbox Controllers
Write-Host "-- [1] XInput / Xbox-Class Controllers --" -ForegroundColor Yellow
$xInputDevices = Get-PnpDevice | Where-Object {
    ($_.Class -match "Xbox|XnaComposite" -or
     $_.FriendlyName -match "Xbox|XInput|Game Controller") -and
    $_.Status -eq "OK"
}
if ($xInputDevices) {
    foreach ($dev in $xInputDevices) {
        Write-Host "  + $($dev.FriendlyName)" -ForegroundColor Green
        Write-Host "    InstanceId : $($dev.InstanceId)"
        Write-Host "    Class      : $($dev.Class)"
        Write-Host "    Status     : $($dev.Status)"
        Write-Host ""
    }
} else {
    Write-Host "  (none detected)" -ForegroundColor DarkGray
    Write-Host ""
}

# 2. HID Devices (all, highlight gamepad-related)
Write-Host "-- [2] All HID Devices --" -ForegroundColor Yellow
$hidDevices = Get-PnpDevice -Class "HIDClass" -Status "OK" -ErrorAction SilentlyContinue
if ($hidDevices) {
    foreach ($dev in $hidDevices) {
        $highlight = $false
        if ($dev.FriendlyName -match "game|pad|joy|controller|flydigi|vader|xinput" -or
            $dev.InstanceId -match "VID_2F24") {
            $highlight = $true
        }
        
        if ($highlight) {
            Write-Host "  * $($dev.FriendlyName)" -ForegroundColor Green
            Write-Host "    InstanceId : $($dev.InstanceId)"
            
            $hwIds = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName "DEVPKEY_Device_HardwareIds" -ErrorAction SilentlyContinue).Data
            if ($hwIds) {
                foreach ($id in $hwIds) {
                    Write-Host "    HardwareId : $id" -ForegroundColor DarkCyan
                }
            }
            Write-Host ""
        } else {
            Write-Host "    $($dev.FriendlyName)" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  (none found)" -ForegroundColor DarkGray
}
Write-Host ""

# 3. USB Composite Devices - FlyDigi VID (0x2F24)
Write-Host "-- [3] USB Devices with FlyDigi VID (0x2F24) --" -ForegroundColor Yellow
$usbDevices = Get-PnpDevice -Status "OK" | Where-Object {
    $_.InstanceId -match "2F24"
}
if ($usbDevices) {
    foreach ($dev in $usbDevices) {
        Write-Host "  * $($dev.FriendlyName)" -ForegroundColor Green
        Write-Host "    InstanceId : $($dev.InstanceId)"
        Write-Host "    Class      : $($dev.Class)"
        
        $hwIds = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName "DEVPKEY_Device_HardwareIds" -ErrorAction SilentlyContinue).Data
        if ($hwIds) {
            foreach ($id in $hwIds) {
                Write-Host "    HardwareId : $id" -ForegroundColor DarkCyan
            }
        }
        
        $children = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName "DEVPKEY_Device_Children" -ErrorAction SilentlyContinue).Data
        if ($children) {
            Write-Host "    Children   :" -ForegroundColor Magenta
            foreach ($child in $children) {
                $childDev = Get-PnpDevice -InstanceId $child -ErrorAction SilentlyContinue
                if ($childDev) {
                    Write-Host "      -> $($childDev.FriendlyName) [$($childDev.Class)]" -ForegroundColor Magenta
                } else {
                    Write-Host "      -> $child" -ForegroundColor Magenta
                }
            }
        }
        Write-Host ""
    }
} else {
    Write-Host "  (none found - controller may use a different VID)" -ForegroundColor DarkGray
    Write-Host ""
}

# 4. Broader search: any gamepad-looking USB device
Write-Host "-- [4] All Gamepad/Controller USB Devices --" -ForegroundColor Yellow
$gamepadDevices = Get-PnpDevice -Status "OK" | Where-Object {
    $_.FriendlyName -match "game|pad|joy|controller|xbox|xinput|flydigi|vader" -and
    $_.Class -notmatch "Processor|Monitor|Display"
}
if ($gamepadDevices) {
    foreach ($dev in $gamepadDevices) {
        Write-Host "  * $($dev.FriendlyName)" -ForegroundColor Green
        Write-Host "    InstanceId : $($dev.InstanceId)"
        Write-Host "    Class      : $($dev.Class)"
        
        $hwIds = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName "DEVPKEY_Device_HardwareIds" -ErrorAction SilentlyContinue).Data
        if ($hwIds) {
            foreach ($id in $hwIds) {
                Write-Host "    HardwareId : $id" -ForegroundColor DarkCyan
            }
        }
        
        $children = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName "DEVPKEY_Device_Children" -ErrorAction SilentlyContinue).Data
        if ($children) {
            Write-Host "    Children   :" -ForegroundColor Magenta
            foreach ($child in $children) {
                $childDev = Get-PnpDevice -InstanceId $child -ErrorAction SilentlyContinue
                if ($childDev) {
                    Write-Host "      -> $($childDev.FriendlyName) [$($childDev.Class)]" -ForegroundColor Magenta
                } else {
                    Write-Host "      -> $child" -ForegroundColor Magenta
                }
            }
        }
        Write-Host ""
    }
} else {
    Write-Host "  (none found)" -ForegroundColor DarkGray
    Write-Host ""
}

# 5. WMI detail for gamepad-related HID/USB entries
Write-Host "-- [5] WMI - Win32_PnPEntity (Gamepad/Controller) --" -ForegroundColor Yellow
$wmiResults = Get-CimInstance Win32_PnPEntity | Where-Object {
    $_.Name -match "game|pad|joy|controller|xbox|xinput|flydigi|vader" -and
    $_.PNPDeviceID -match "HID|USB"
} | Select-Object Name, PNPDeviceID, Manufacturer, Service | Sort-Object Name -Unique

if ($wmiResults) {
    foreach ($r in $wmiResults) {
        Write-Host "  $($r.Name)" -ForegroundColor Green
        Write-Host "    PNPDeviceID  : $($r.PNPDeviceID)"
        Write-Host "    Manufacturer : $($r.Manufacturer)"
        Write-Host "    Driver/Svc   : $($r.Service)"
        Write-Host ""
    }
} else {
    Write-Host "  (none found)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  Done. Look for composite children - vendor config" -ForegroundColor Cyan
Write-Host "  interfaces hide alongside the XInput gamepad interface." -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

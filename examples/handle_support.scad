$fn=32;

module handle_support() {
    difference() {
        hull() {
            translate([0,0,0.5])cube([120, 30, 1], center=true);
            translate([0,0,14]) cube([120, 19, 1], center=true);
        }
        for (x=[-96/2, 96/2]) {
                translate([x, 0, 0]){
                    translate([0, 0, 5]){cylinder(h=20, d=11, center=false);}
                    translate([0, 0, -0.5]){cylinder(h=10, d=5, center=false);}
                    translate([0, 0, -0.5]){cylinder(h=2, d1=9.5, d2=5.2, center=false);}
                }
            }
        // Cutout for handle
        // translate([-20, -10, 0])
        //     cube([40, 20, 5], center=true);
    }
}   handle_support();
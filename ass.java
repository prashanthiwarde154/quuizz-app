import java.util.*;
public class ass{
    public static void main(String args[]){

        scanner sc=new scanner(System.in);
        System.out.println("Enter A ");
        int a=sc.nextInt();
        
        if(a>0){
            System.out.println("Positive");
        }else if(a==0){
            System.out.println("Zero")
        }else{
            System.out.println("Negative")
        }
    }
}
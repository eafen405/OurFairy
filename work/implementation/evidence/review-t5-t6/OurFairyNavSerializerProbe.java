public class OurFairyNavSerializerProbe {
public static void main(String[] args) throws Exception {
 for(String name:new String[]{"Account", "Sessions"}) {
  Class<?> type=Class.forName("me.rerere.rikkahub.Screen$"+name);
  try { System.out.println(name+": "+kotlinx.serialization.SerializersKt.serializer(kotlin.jvm.JvmClassMappingKt.getKotlinClass(type))); }
  catch(Exception ex){System.out.println(name+": "+ex);}
 }
}
}